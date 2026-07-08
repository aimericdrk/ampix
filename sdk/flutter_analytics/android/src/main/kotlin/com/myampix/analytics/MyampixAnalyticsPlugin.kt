package com.myampix.analytics

import android.content.Context
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.plugin.common.EventChannel

/**
 * MyAmpix native store-purchase autocapture (Android half).
 *
 * Wraps a Google Play [BillingClient] purely as an OBSERVER of the app's own
 * in-app-purchase transactions — the same role RevenueCat/Adjust play when
 * they hook Play Billing. This plugin never calls `launchBillingFlow`,
 * never acknowledges a purchase, and never consumes one: fulfilment stays
 * the responsibility of whatever code in the host app actually granted the
 * purchase. Forwarded payloads are consumed by
 * `lib/src/autocapture/purchase_autocapture.dart` over the
 * `myampix_analytics/purchases` [EventChannel] and re-emitted through the
 * Dart facade as the reserved `$in_app_purchase` event.
 *
 * IMPORTANT ANDROID CAVEAT (unlike iOS, where `SKPaymentQueue` is a single
 * process-wide queue any observer can attach to): Play Billing's
 * [PurchasesUpdatedListener] only fires for purchases launched through THIS
 * SAME [BillingClient] instance. If the host app purchases through its own,
 * separate `BillingClient` (e.g. RevenueCat's), this listener never
 * observes that purchase flow directly. To still surface those, this
 * plugin also calls `queryPurchasesAsync` once its client connects, which
 * returns every INAPP purchase owned by the signed-in Play account for this
 * app package — regardless of which client/session originally launched it
 * — mirroring how StoreKit replays existing transactions to a new
 * observer. Either way, this is still only ever the APP'S OWN
 * transactions: there is no API for observing another app's or another
 * user's purchases (that is all a sandboxed app can ever see).
 *
 * Kept deliberately defensive: every entry point is wrapped so a Play
 * Billing failure (missing Play Services, library mismatch, disconnects,
 * malformed callback data, ...) never crashes the host app.
 */
class MyampixAnalyticsPlugin :
    FlutterPlugin,
    PurchasesUpdatedListener {

    private var eventChannel: EventChannel? = null
    private var eventSink: EventChannel.EventSink? = null
    private var billingClient: BillingClient? = null

    /** Attribution (install-referrer) channel + its Dart listener sink. */
    private var attributionChannel: EventChannel? = null
    private var attributionSink: EventChannel.EventSink? = null
    private var referrerClient: InstallReferrerClient? = null

    /** De-dupes a purchase seen both via the live listener and the replay query. */
    private val seenTransactionIds = mutableSetOf<String>()

    /** Buffers payloads observed before Dart attaches a stream listener. */
    private val pendingPayloads = mutableListOf<Map<String, Any?>>()

    /** Buffers an install referrer fetched before Dart attaches its listener. */
    private var pendingReferrer: String? = null

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        val channel = EventChannel(binding.binaryMessenger, CHANNEL_NAME)
        channel.setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink) {
                    eventSink = events
                    if (pendingPayloads.isNotEmpty()) {
                        pendingPayloads.forEach { events.success(it) }
                        pendingPayloads.clear()
                    }
                }

                override fun onCancel(arguments: Any?) {
                    eventSink = null
                }
            },
        )
        eventChannel = channel

        val attribution = EventChannel(binding.binaryMessenger, ATTRIBUTION_CHANNEL_NAME)
        attribution.setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink) {
                    attributionSink = events
                    pendingReferrer?.let {
                        events.success(it)
                        pendingReferrer = null
                    }
                }

                override fun onCancel(arguments: Any?) {
                    attributionSink = null
                }
            },
        )
        attributionChannel = attribution

        startBillingClient(binding.applicationContext)
        maybeFetchInstallReferrer(binding.applicationContext)
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        eventChannel?.setStreamHandler(null)
        eventChannel = null
        eventSink = null
        attributionChannel?.setStreamHandler(null)
        attributionChannel = null
        attributionSink = null
        try {
            billingClient?.endConnection()
        } catch (_: Throwable) {
            // Never crash the host on teardown.
        }
        billingClient = null
        try {
            referrerClient?.endConnection()
        } catch (_: Throwable) {
            // Never crash the host on teardown.
        }
        referrerClient = null
    }

    private fun startBillingClient(context: Context) {
        try {
            val client = BillingClient.newBuilder(context)
                .setListener(this)
                .enablePendingPurchases()
                .build()
            billingClient = client
            client.startConnection(
                object : BillingClientStateListener {
                    override fun onBillingSetupFinished(billingResult: BillingResult) {
                        if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                            replayExistingPurchases(client)
                        }
                    }

                    override fun onBillingServiceDisconnected() {
                        // Never crash; a future purchase update (if the
                        // client reconnects) simply resumes forwarding.
                    }
                },
            )
        } catch (_: Throwable) {
            // Defensive: Play Billing may be unavailable at runtime (no
            // Play Services, library mismatch, ...). Never crash the host.
        }
    }

    /**
     * Replays purchases that already exist for this account/app so a
     * purchase made through a DIFFERENT billing client (see class doc)
     * still gets picked up, much like StoreKit replays its queue to a
     * freshly attached observer.
     */
    private fun replayExistingPurchases(client: BillingClient) {
        try {
            val params = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP)
                .build()
            client.queryPurchasesAsync(params) { billingResult, purchases ->
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    purchases.forEach { handlePurchase(client, it) }
                }
            }
        } catch (_: Throwable) {
            // Best-effort only.
        }
    }

    override fun onPurchasesUpdated(billingResult: BillingResult, purchases: MutableList<Purchase>?) {
        try {
            if (billingResult.responseCode != BillingClient.BillingResponseCode.OK) return
            val client = billingClient ?: return
            purchases?.forEach { handlePurchase(client, it) }
        } catch (_: Throwable) {
            // Never crash the host from a billing callback.
        }
    }

    private fun handlePurchase(client: BillingClient, purchase: Purchase) {
        try {
            if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return
            val transactionId = purchase.orderId ?: purchase.purchaseToken
            if (transactionId.isNullOrEmpty()) return
            if (!seenTransactionIds.add(transactionId)) return // already forwarded

            fetchProductPricing(client, purchase.products) { priceMicros, currency ->
                if (purchase.products.isEmpty()) return@fetchProductPricing
                purchase.products.forEach { productId ->
                    emit(
                        mapOf(
                            "productId" to productId,
                            "price" to priceMicros?.let { it / 1_000_000.0 },
                            "currency" to currency,
                            "quantity" to purchase.quantity,
                            "transactionId" to transactionId,
                            "store" to "play_store",
                        ),
                    )
                }
            }
        } catch (_: Throwable) {
            // Never crash the host from a billing callback.
        }
    }

    /**
     * Best-effort price/currency lookup for the purchase's first product
     * via `queryProductDetailsAsync`. Play Billing purchases do not carry
     * price themselves — only `ProductDetails` does. Failure (or an app
     * with no matching product details, e.g. mismatched sandbox config)
     * degrades to `null`/`null`, never a crash.
     */
    private fun fetchProductPricing(
        client: BillingClient,
        productIds: List<String>,
        onResult: (priceMicros: Long?, currency: String?) -> Unit,
    ) {
        val firstProductId = productIds.firstOrNull()
        if (firstProductId == null) {
            onResult(null, null)
            return
        }
        try {
            val product = QueryProductDetailsParams.Product.newBuilder()
                .setProductId(firstProductId)
                .setProductType(BillingClient.ProductType.INAPP)
                .build()
            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(listOf(product))
                .build()
            client.queryProductDetailsAsync(params) { billingResult, productDetailsList ->
                val offer = productDetailsList.firstOrNull()?.oneTimePurchaseOfferDetails
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK && offer != null) {
                    onResult(offer.priceAmountMicros, offer.priceCurrencyCode)
                } else {
                    onResult(null, null)
                }
            }
        } catch (_: Throwable) {
            onResult(null, null)
        }
    }

    private fun emit(payload: Map<String, Any?>) {
        val sink = eventSink
        if (sink != null) {
            sink.success(payload)
        } else {
            pendingPayloads.add(payload)
        }
    }

    /**
     * Fetches the Google Play install referrer ONCE (first launch) and
     * forwards its raw `utm_*`-carrying query string over the attribution
     * channel. A persisted flag guarantees the referrer is only ever
     * forwarded once, so the Dart side emits a single first-touch
     * `$campaign_touch` (`$attribution_source: "install_referrer"`) — not one
     * per launch. iOS has no install-referrer equivalent; its plugin half
     * registers this channel as a documented no-op.
     *
     * Defensive throughout: a missing Play Store, service disconnect, or
     * malformed referrer degrades to "no touch", never a crash.
     */
    private fun maybeFetchInstallReferrer(context: Context) {
        try {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            if (prefs.getBoolean(PREF_REFERRER_FORWARDED, false)) return
            val client = InstallReferrerClient.newBuilder(context).build()
            referrerClient = client
            client.startConnection(
                object : InstallReferrerStateListener {
                    override fun onInstallReferrerSetupFinished(responseCode: Int) {
                        try {
                            if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
                                val referrer = client.installReferrer.installReferrer
                                if (!referrer.isNullOrEmpty()) {
                                    emitReferrer(referrer)
                                    prefs.edit()
                                        .putBoolean(PREF_REFERRER_FORWARDED, true)
                                        .apply()
                                }
                            }
                        } catch (_: Throwable) {
                            // Best-effort only: never crash on a referrer read.
                        } finally {
                            try {
                                client.endConnection()
                            } catch (_: Throwable) {
                                // Never crash on teardown.
                            }
                        }
                    }

                    override fun onInstallReferrerServiceDisconnected() {
                        // Never crash; the persisted flag stays unset so a
                        // future launch can retry the one-time fetch.
                    }
                },
            )
        } catch (_: Throwable) {
            // Install Referrer may be unavailable (no Play Store, ...). Never
            // crash the host.
        }
    }

    private fun emitReferrer(referrer: String) {
        val sink = attributionSink
        if (sink != null) {
            sink.success(referrer)
        } else {
            pendingReferrer = referrer
        }
    }

    private companion object {
        const val CHANNEL_NAME = "myampix_analytics/purchases"
        const val ATTRIBUTION_CHANNEL_NAME = "myampix_analytics/attribution"
        const val PREFS_NAME = "myampix_analytics"
        const val PREF_REFERRER_FORWARDED = "install_referrer_forwarded"
    }
}
