package com.myampix.purchases

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * MyAmpix Purchases — Android native store layer (Google Play Billing v7+).
 *
 * Unlike the analytics plugin (a PASSIVE billing observer), this plugin is the
 * ACTIVE biller for the RevenueCat-style purchases SDK: it fetches
 * [ProductDetails], launches the purchase flow with an obfuscated account id
 * (our `appAccountToken` self-attribution), acknowledges/consumes on command,
 * and replays out-of-band / interrupted purchases so Dart can POST them to
 * `mobile_purchase`'s `/v1/receipts`.
 *
 * It holds NO server URL or key and does NO HTTP — it only surfaces store
 * receipts (the Play `purchaseToken`) over two channels (§5):
 *   · MethodChannel `myampix_purchases/methods`  (Dart → native request/response)
 *   · EventChannel  `myampix_purchases/transactions` (native → Dart pushes)
 *
 * Threading: BillingClient is built with no custom executor, so Play Billing
 * v7 delivers every listener callback on the main thread — the same thread
 * `onMethodCall` runs on — making it safe to resolve [MethodChannel.Result]
 * and [EventChannel.EventSink] directly inside those callbacks.
 *
 * Kept deliberately defensive: every entry point is wrapped so a Play Billing
 * failure (missing Play Services, disconnect, malformed callback) degrades to
 * a typed error / dropped event, never a host crash.
 */
class MyampixPurchasesPlugin :
    FlutterPlugin,
    ActivityAware,
    MethodChannel.MethodCallHandler,
    PurchasesUpdatedListener {

    private var methodChannel: MethodChannel? = null
    private var eventChannel: EventChannel? = null
    private var eventSink: EventChannel.EventSink? = null
    private var billingClient: BillingClient? = null
    private var activity: Activity? = null

    /** ProductDetails learned via getProducts()/purchase(); reused to launch flows. */
    private val productDetailsById = mutableMapOf<String, ProductDetails>()

    /** Purchases keyed by purchaseToken so finishTransaction() can ack/consume by token. */
    private val purchasesByToken = mutableMapOf<String, Purchase>()

    /** De-dupes a purchase seen via both the live listener and the connect/restore replay. */
    private val seenTokens = mutableSetOf<String>()

    /** Buffers out-of-band payloads observed before Dart attaches its EventChannel listener. */
    private val pendingEvents = mutableListOf<Map<String, Any?>>()

    /** The single in-flight explicit purchase() call, resolved by onPurchasesUpdated. */
    private var pendingPurchaseResult: MethodChannel.Result? = null
    private var pendingPurchaseProductId: String? = null

    // ---- FlutterPlugin ----

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        val methods = MethodChannel(binding.binaryMessenger, METHOD_CHANNEL)
        methods.setMethodCallHandler(this)
        methodChannel = methods

        val events = EventChannel(binding.binaryMessenger, EVENT_CHANNEL)
        events.setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, sink: EventChannel.EventSink) {
                    eventSink = sink
                    if (pendingEvents.isNotEmpty()) {
                        pendingEvents.forEach { sink.success(it) }
                        pendingEvents.clear()
                    }
                }

                override fun onCancel(arguments: Any?) {
                    eventSink = null
                }
            },
        )
        eventChannel = events

        startBillingClient(binding.applicationContext)
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        methodChannel?.setMethodCallHandler(null)
        methodChannel = null
        eventChannel?.setStreamHandler(null)
        eventChannel = null
        eventSink = null
        try {
            billingClient?.endConnection()
        } catch (_: Throwable) {
            // Never crash the host on teardown.
        }
        billingClient = null
    }

    // ---- ActivityAware (launchBillingFlow needs a foreground Activity) ----

    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onDetachedFromActivityForConfigChanges() {
        activity = null
    }

    override fun onDetachedFromActivity() {
        activity = null
    }

    // ---- BillingClient lifecycle ----

    private fun startBillingClient(context: Context) {
        try {
            val client = BillingClient.newBuilder(context)
                .setListener(this)
                .enablePendingPurchases(
                    PendingPurchasesParams.newBuilder().enableOneTimeProducts().build(),
                )
                .build()
            billingClient = client
            client.startConnection(
                object : BillingClientStateListener {
                    override fun onBillingSetupFinished(billingResult: BillingResult) {
                        if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                            // Renewed / interrupted purchases waiting since a prior
                            // session re-deliver here (unacknowledged only) so Dart
                            // can POST /v1/receipts and then finishTransaction().
                            replayPurchases(client, REASON_RENEWAL, onlyUnacknowledged = true)
                        }
                    }

                    override fun onBillingServiceDisconnected() {
                        // Never crash; method calls lazily reconnect via runWhenReady().
                    }
                },
            )
        } catch (_: Throwable) {
            // Play Billing may be unavailable (no Play Services, ...). Never crash.
        }
    }

    private fun runWhenReady(result: MethodChannel.Result, action: (BillingClient) -> Unit) {
        val client = billingClient
        if (client == null) {
            result.error(ERR_STORE_PROBLEM, "Billing client unavailable", null)
            return
        }
        if (client.isReady) {
            action(client)
            return
        }
        var settled = false
        client.startConnection(
            object : BillingClientStateListener {
                override fun onBillingSetupFinished(billingResult: BillingResult) {
                    if (settled) return
                    settled = true
                    if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                        // This branch only runs when the client had disconnected
                        // (client.isReady was false above), i.e. a mid-session
                        // reconnect — the initial connect's replay is handled
                        // separately by startBillingClient(). A renewal that
                        // landed while disconnected would otherwise only be
                        // caught at the next cold start; seenTokens dedupes
                        // against the live listener / other replays.
                        replayPurchases(client, REASON_RENEWAL, onlyUnacknowledged = true)
                        action(client)
                    } else {
                        result.error(ERR_STORE_PROBLEM, billingResult.debugMessage, null)
                    }
                }

                override fun onBillingServiceDisconnected() {
                    // The OK/!OK branch above settles on the next setup callback.
                }
            },
        )
    }

    // ---- MethodChannel ----

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        try {
            when (call.method) {
                "getProducts" -> getProducts(call, result)
                "purchase" -> purchase(call, result)
                "finishTransaction" -> finishTransaction(call, result)
                "restore" -> restore(result)
                "canMakePayments" -> canMakePayments(result)
                else -> result.notImplemented()
            }
        } catch (t: Throwable) {
            result.error(ERR_STORE_PROBLEM, t.message, null)
        }
    }

    /** getProducts({ productIds }) -> List<Map> ; unfound ids omitted. */
    private fun getProducts(call: MethodCall, result: MethodChannel.Result) {
        val productIds = call.argument<List<String>>("productIds") ?: emptyList()
        if (productIds.isEmpty()) {
            result.success(emptyList<Map<String, Any?>>())
            return
        }
        runWhenReady(result) { client ->
            val merged = mutableListOf<Map<String, Any?>>()
            val addedIds = mutableSetOf<String>()
            var remaining = 2
            var settled = false
            for (type in listOf(BillingClient.ProductType.SUBS, BillingClient.ProductType.INAPP)) {
                queryDetails(client, productIds, type) { details ->
                    for (d in details) {
                        productDetailsById[d.productId] = d
                        if (addedIds.add(d.productId)) {
                            mapProductDetails(d)?.let { merged.add(it) }
                        }
                    }
                    remaining -= 1
                    if (remaining == 0 && !settled) {
                        settled = true
                        result.success(merged)
                    }
                }
            }
        }
    }

    private fun queryDetails(
        client: BillingClient,
        productIds: List<String>,
        type: String,
        onResult: (List<ProductDetails>) -> Unit,
    ) {
        try {
            val products = productIds.map { id ->
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(id)
                    .setProductType(type)
                    .build()
            }
            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(products)
                .build()
            client.queryProductDetailsAsync(params) { billingResult, productDetailsList ->
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    onResult(productDetailsList)
                } else {
                    onResult(emptyList())
                }
            }
        } catch (_: Throwable) {
            onResult(emptyList())
        }
    }

    /**
     * Maps one [ProductDetails] to the §5 getProducts row. One-time products
     * read `oneTimePurchaseOfferDetails`; subscriptions read the LAST pricing
     * phase of the first offer (the base recurring price + its ISO-8601
     * `billingPeriod`, e.g. "P1M"). Micros are converted to a double price.
     */
    private fun mapProductDetails(d: ProductDetails): Map<String, Any?>? {
        val oneTime = d.oneTimePurchaseOfferDetails
        if (oneTime != null) {
            return mapOf(
                "storeProductId" to d.productId,
                "priceString" to oneTime.formattedPrice,
                "price" to oneTime.priceAmountMicros / 1_000_000.0,
                "currencyCode" to oneTime.priceCurrencyCode,
                "title" to d.title,
                "description" to d.description,
                "subscriptionPeriodIso8601" to null,
            )
        }
        val phase = d.subscriptionOfferDetails
            ?.firstOrNull()
            ?.pricingPhases
            ?.pricingPhaseList
            ?.lastOrNull()
            ?: return null
        return mapOf(
            "storeProductId" to d.productId,
            "priceString" to phase.formattedPrice,
            "price" to phase.priceAmountMicros / 1_000_000.0,
            "currencyCode" to phase.priceCurrencyCode,
            "title" to d.title,
            "description" to d.description,
            "subscriptionPeriodIso8601" to phase.billingPeriod,
        )
    }

    /** purchase({ storeProductId, appAccountToken }) -> resolved by onPurchasesUpdated. */
    private fun purchase(call: MethodCall, result: MethodChannel.Result) {
        val storeProductId = call.argument<String>("storeProductId")
        val appAccountToken = call.argument<String>("appAccountToken")
        if (storeProductId.isNullOrEmpty()) {
            result.error(ERR_STORE_PROBLEM, "storeProductId is required", null)
            return
        }
        val currentActivity = activity
        if (currentActivity == null) {
            result.error(ERR_STORE_PROBLEM, "No foreground activity for the billing flow", null)
            return
        }
        if (pendingPurchaseResult != null) {
            result.error(ERR_STORE_PROBLEM, "A purchase is already in progress", null)
            return
        }
        runWhenReady(result) { client ->
            val cached = productDetailsById[storeProductId]
            if (cached != null) {
                launchFlow(client, currentActivity, cached, appAccountToken, result)
                return@runWhenReady
            }
            // Not cached (purchase without a prior getProducts). Fetch SUBS then
            // INAPP details on demand, then launch — or error if truly unknown.
            var remaining = 2
            var found: ProductDetails? = null
            var settled = false
            for (type in listOf(BillingClient.ProductType.SUBS, BillingClient.ProductType.INAPP)) {
                queryDetails(client, listOf(storeProductId), type) { details ->
                    details.firstOrNull { it.productId == storeProductId }?.let {
                        productDetailsById[it.productId] = it
                        found = it
                    }
                    remaining -= 1
                    if (remaining == 0 && !settled) {
                        settled = true
                        val d = found
                        if (d == null) {
                            result.error(
                                ERR_PRODUCT_NOT_AVAILABLE,
                                "Product $storeProductId not found",
                                null,
                            )
                        } else {
                            launchFlow(client, currentActivity, d, appAccountToken, result)
                        }
                    }
                }
            }
        }
    }

    private fun launchFlow(
        client: BillingClient,
        activity: Activity,
        details: ProductDetails,
        appAccountToken: String?,
        result: MethodChannel.Result,
    ) {
        val productParamsBuilder = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(details)
        // Subscriptions require an offer token; one-time products must not set one.
        details.subscriptionOfferDetails?.firstOrNull()?.offerToken?.let {
            productParamsBuilder.setOfferToken(it)
        }
        val flowBuilder = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(productParamsBuilder.build()))
        if (!appAccountToken.isNullOrEmpty()) {
            // Self-attribution: binds the Play purchase to our app-user-id (the
            // Android analogue of StoreKit 2's .appAccountToken).
            flowBuilder.setObfuscatedAccountId(appAccountToken)
        }
        // Register the pending call BEFORE launching so a fast callback resolves it.
        pendingPurchaseResult = result
        pendingPurchaseProductId = details.productId
        val launch = client.launchBillingFlow(activity, flowBuilder.build())
        if (launch.responseCode != BillingClient.BillingResponseCode.OK) {
            // The sheet never opened; resolve now and clear the pending call.
            clearPendingPurchase()
            result.error(mapBillingCode(launch.responseCode), launch.debugMessage, null)
        }
    }

    override fun onPurchasesUpdated(
        billingResult: BillingResult,
        purchases: MutableList<Purchase>?,
    ) {
        try {
            val pending = pendingPurchaseResult
            val pendingId = pendingPurchaseProductId
            if (billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
                if (pending != null) {
                    clearPendingPurchase()
                    pending.error(mapBillingCode(billingResult.responseCode), billingResult.debugMessage, null)
                }
                return
            }
            val list = purchases ?: emptyList()
            list.forEach { indexPurchase(it) }
            var handledPending = false
            for (purchase in list) {
                val matchesPending = !handledPending &&
                    pending != null &&
                    (pendingId == null || purchase.products.contains(pendingId))
                if (matchesPending) {
                    handledPending = true
                    clearPendingPurchase()
                    resolvePendingPurchase(pending!!, purchase, pendingId)
                } else {
                    // A purchase/renewal completed outside our explicit call.
                    emitPurchase(purchase, REASON_RENEWAL)
                }
            }
            if (!handledPending && pending != null) {
                // OK with no purchase object (rare). Don't hang the Dart Future:
                // surface storeProblem; the purchase (if any) still re-delivers
                // on the next connect replay, so nothing is lost.
                clearPendingPurchase()
                pending.error(ERR_STORE_PROBLEM, "Purchase update carried no purchase", null)
            }
        } catch (_: Throwable) {
            // Never crash the host from a billing callback.
        }
    }

    /**
     * Resolves the explicit purchase() MethodChannel call. Deliberately does
     * NOT acknowledge here — Dart calls finishTransaction() only AFTER
     * `mobile_purchase` grants the entitlement (§4), so a server failure leaves
     * the purchase un-acked and it re-delivers on next launch (no lost purchase).
     *
     * `transactionId` carries the Play `purchaseToken` — the same value
     * `finishTransaction()` consumes as the acknowledge/consume handle (Play
     * Billing has no separate "order id" the ack/consume APIs accept). This
     * mirrors iOS's `fetchToken` in delivery mechanics only: StoreKit 2
     * separately re-delivers the same transaction on `Transaction.updates`
     * (which DOES carry an id) for `PurchaseController._finishQuietly` to
     * consume, but `PurchasesUpdatedListener` is Play Billing's ONLY delivery
     * path for an explicit purchase. Omitting `transactionId` here would
     * leave `purchase.transactionId` null in Dart, so `purchaseStoreProduct`
     * would never call `finishTransaction()` until the next cold-start
     * replay. `StorePurchase.transactionId` is nullable for exactly this
     * asymmetry; on Android it always equals `fetchToken` — both are the
     * purchaseToken — which is fine since `StorePurchase.transactionId` is
     * an opaque finish-handle by contract, not necessarily distinct from the
     * receipt token.
     */
    private fun resolvePendingPurchase(
        result: MethodChannel.Result,
        purchase: Purchase,
        productId: String?,
    ) {
        when (purchase.purchaseState) {
            Purchase.PurchaseState.PURCHASED -> {
                val storeProductId = productId ?: purchase.products.firstOrNull() ?: ""
                result.success(
                    mapOf(
                        "platform" to PLATFORM,
                        "fetchToken" to purchase.purchaseToken,
                        "storeProductId" to storeProductId,
                        "transactionId" to purchase.purchaseToken,
                    ),
                )
            }
            Purchase.PurchaseState.PENDING ->
                result.error(ERR_PAYMENT_PENDING, "Purchase is pending", null)
            else ->
                result.error(ERR_STORE_PROBLEM, "Purchase in unspecified state", null)
        }
    }

    /** finishTransaction({ transactionId, consume? }) -> null (ack default / consume opt-in). */
    private fun finishTransaction(call: MethodCall, result: MethodChannel.Result) {
        val token = call.argument<String>("transactionId")
        val consume = call.argument<Boolean>("consume") ?: false
        if (token.isNullOrEmpty()) {
            result.error(ERR_STORE_PROBLEM, "transactionId (purchase token) is required", null)
            return
        }
        runWhenReady(result) { client ->
            if (consume) {
                val params = ConsumeParams.newBuilder().setPurchaseToken(token).build()
                client.consumeAsync(params) { billingResult, _ ->
                    if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                        result.success(null)
                    } else {
                        result.error(ERR_STORE_PROBLEM, billingResult.debugMessage, null)
                    }
                }
            } else {
                if (purchasesByToken[token]?.isAcknowledged == true) {
                    // Idempotent: already acknowledged (e.g. a re-delivered replay).
                    result.success(null)
                    return@runWhenReady
                }
                val params = AcknowledgePurchaseParams.newBuilder().setPurchaseToken(token).build()
                client.acknowledgePurchase(params) { billingResult ->
                    if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                        result.success(null)
                    } else {
                        result.error(ERR_STORE_PROBLEM, billingResult.debugMessage, null)
                    }
                }
            }
        }
    }

    /**
     * restore() -> null; re-emits ALL current purchases on the EventChannel,
     * then (final-review I-1) a `reason: "restore_complete"` sentinel once
     * every purchase has been queried and (if owned) emitted.
     *
     * `result.success(null)` acks BEFORE the SUBS/INAPP queries below settle
     * — matching iOS/StoreKit 2's immediate ack — so Dart cannot treat this
     * method's return as "the replay is done". [replayPurchases]' onComplete
     * callback fires only after BOTH product-type queries have returned,
     * regardless of how long Play Billing takes; Dart's `restorePurchases()`
     * waits for the sentinel instead of a fixed delay.
     */
    private fun restore(result: MethodChannel.Result) {
        runWhenReady(result) { client ->
            // A deliberate restore re-binds everything to the (possibly new)
            // app-user-id, so clear the de-dupe and emit every purchase.
            seenTokens.clear()
            replayPurchases(client, REASON_RESTORE, onlyUnacknowledged = false) {
                emit(mapOf("reason" to REASON_RESTORE_COMPLETE))
            }
            result.success(null)
        }
    }

    private fun canMakePayments(result: MethodChannel.Result) {
        val client = billingClient
        if (client != null && client.isReady) {
            val supported = client.isFeatureSupported(BillingClient.FeatureType.SUBSCRIPTIONS)
            result.success(supported.responseCode == BillingClient.BillingResponseCode.OK)
        } else {
            result.success(false)
        }
    }

    /**
     * Queries owned purchases (SUBS + INAPP) and emits each on the EventChannel.
     * `onlyUnacknowledged` restricts a connect replay to genuinely interrupted
     * purchases (still awaiting a server grant); restore() passes false to emit all.
     *
     * `onComplete` (final-review I-1), when given, fires exactly once, after
     * BOTH product-type queries have settled (success, failure, or a thrown
     * exception) — regardless of order. Only `restore()` uses it today; the
     * connect-time/reconnect replays don't need a completion signal.
     */
    private fun replayPurchases(
        client: BillingClient,
        reason: String,
        onlyUnacknowledged: Boolean,
        onComplete: (() -> Unit)? = null,
    ) {
        var remaining = 2
        fun settleOne() {
            remaining -= 1
            if (remaining == 0) onComplete?.invoke()
        }
        for (type in listOf(BillingClient.ProductType.SUBS, BillingClient.ProductType.INAPP)) {
            try {
                val params = QueryPurchasesParams.newBuilder().setProductType(type).build()
                client.queryPurchasesAsync(params) { billingResult, purchases ->
                    if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                        for (p in purchases) {
                            indexPurchase(p)
                            if (onlyUnacknowledged && p.isAcknowledged) continue
                            emitPurchase(p, reason)
                        }
                    }
                    settleOne()
                }
            } catch (_: Throwable) {
                // Best-effort only.
                settleOne()
            }
        }
    }

    private fun indexPurchase(purchase: Purchase) {
        val token = purchase.purchaseToken
        if (token.isNotEmpty()) purchasesByToken[token] = purchase
    }

    private fun emitPurchase(purchase: Purchase, reason: String) {
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return
        val token = purchase.purchaseToken
        if (token.isEmpty()) return
        if (!seenTokens.add(token)) return // de-dupe live listener vs replay
        val storeProductId = purchase.products.firstOrNull() ?: return
        emit(
            mapOf(
                "platform" to PLATFORM,
                "fetchToken" to token,
                "storeProductId" to storeProductId,
                // transactionId carries the purchaseToken — the finish
                // handle finishTransaction() acks/consumes — not orderId.
                "transactionId" to token,
                "reason" to reason,
            ),
        )
    }

    private fun emit(payload: Map<String, Any?>) {
        val sink = eventSink
        if (sink != null) {
            sink.success(payload)
        } else {
            pendingEvents.add(payload)
        }
    }

    /**
     * Maps a Play `BillingResponseCode` to the §5/§6 error-code contract shared
     * with iOS. `ITEM_ALREADY_OWNED` deliberately falls into the catch-all
     * `storeProblem` bucket: `PurchaseController._mapPlatformException`
     * recognizes exactly four native codes — `userCancelled`, `paymentPending`,
     * `productNotAvailable`, default→`storeProblemError` — and its ONLY path to
     * `productAlreadyPurchasedError` is a 409 from the `mobile_purchase` server,
     * not a native code. So `storeProblem` here is the literal match for "how
     * Dart maps it", not a downgrade.
     */
    private fun mapBillingCode(responseCode: Int): String = when (responseCode) {
        BillingClient.BillingResponseCode.USER_CANCELED -> ERR_USER_CANCELLED
        BillingClient.BillingResponseCode.ITEM_UNAVAILABLE -> ERR_PRODUCT_NOT_AVAILABLE
        // Everything else (SERVICE_*, BILLING_UNAVAILABLE, DEVELOPER_ERROR, ERROR,
        // ITEM_ALREADY_OWNED, ITEM_NOT_OWNED, NETWORK_ERROR, FEATURE_NOT_SUPPORTED)
        // maps to the single §5 store-failure code; PENDING is handled separately.
        else -> ERR_STORE_PROBLEM
    }

    private fun clearPendingPurchase() {
        pendingPurchaseResult = null
        pendingPurchaseProductId = null
    }

    private companion object {
        const val METHOD_CHANNEL = "myampix_purchases/methods"
        const val EVENT_CHANNEL = "myampix_purchases/transactions"
        const val PLATFORM = "PLAY_STORE"
        const val REASON_RENEWAL = "renewal"
        const val REASON_RESTORE = "restore"
        const val REASON_RESTORE_COMPLETE = "restore_complete"
        const val ERR_USER_CANCELLED = "userCancelled"
        const val ERR_PAYMENT_PENDING = "paymentPending"
        const val ERR_PRODUCT_NOT_AVAILABLE = "productNotAvailable"
        const val ERR_STORE_PROBLEM = "storeProblem"
    }
}
