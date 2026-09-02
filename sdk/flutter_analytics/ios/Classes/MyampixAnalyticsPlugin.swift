import Flutter
import StoreKit
import UIKit

/// MyAmpix native store-purchase autocapture (iOS half).
///
/// Registers an `SKPaymentTransactionObserver` on the shared, process-wide
/// `SKPaymentQueue` and forwards `.purchased` transactions to
/// Dart over the `myampix_analytics/purchases` `EventChannel`. Consumed by
/// `lib/src/autocapture/purchase_autocapture.dart`, which re-emits them
/// through the Dart facade as the reserved `$in_app_purchase` event.
///
/// IMPORTANT — this is a PASSIVE observer, exactly like RevenueCat/Adjust's
/// StoreKit hooks: it never calls `finishTransaction`. Finishing/acking a
/// transaction remains the responsibility of whatever code in the host app
/// actually fulfils the purchase (the app's own StoreKit integration,
/// RevenueCat, ...). We only look; we never touch.
///
/// A sandboxed plugin can only ever see transactions that pass through this
/// process's `SKPaymentQueue` — i.e. purchases made by THIS app install.
/// There is no API for observing another app's or another user's
/// purchases; "native" here means "the app's own StoreKit transactions",
/// not store-wide telemetry.
///
/// Kept deliberately defensive: every callback is wrapped so a StoreKit
/// failure or unexpected transaction shape never crashes the host app.
public class MyampixAnalyticsPlugin: NSObject, FlutterPlugin, SKPaymentTransactionObserver, SKProductsRequestDelegate, FlutterStreamHandler {
  private static let channelName = "myampix_analytics/purchases"
  private static let attributionChannelName = "myampix_analytics/attribution"

  private var eventSink: FlutterEventSink?

  /// Transactions observed before Dart attaches a stream listener (the queue
  /// replays them at cold start, before `runApp` completes) are buffered here
  /// and flushed as soon as `onListen` runs, so nothing is silently dropped.
  /// The replay is why Dart de-dupes: this buffer is faithful, not filtered.
  private var pendingPayloads: [[String: Any?]] = []

  /// Best-effort product price/currency cache, keyed by productIdentifier.
  /// Populated asynchronously via `SKProductsRequest`; a transaction is
  /// forwarded immediately regardless of whether this cache is warm yet —
  /// price/currency are simply `nil` until/unless a lookup completes.
  private var productCache: [String: (price: Double, currency: String?)] = [:]
  private var pendingProductRequests: Set<String> = []
  private var productIdsByRequest: [ObjectIdentifier: [String]] = [:]

  public static func register(with registrar: FlutterPluginRegistrar) {
    let instance = MyampixAnalyticsPlugin()
    let eventChannel = FlutterEventChannel(
      name: channelName,
      binaryMessenger: registrar.messenger()
    )
    eventChannel.setStreamHandler(instance)
    SKPaymentQueue.default().add(instance)
    // Keeps the plugin instance alive for the lifetime of the engine so the
    // SKPaymentQueue observer registration above is never deallocated.
    registrar.publish(instance)

    // Marketing-attribution channel — iOS HAS NO INSTALL-REFERRER EQUIVALENT.
    // Unlike Android's Google Play `InstallReferrerClient` (see
    // MyampixAnalyticsPlugin.kt), Apple exposes no API for a generic
    // install-attribution string (SKAdNetwork is a privacy-preserving,
    // postback-only mechanism, not a utm_* referrer). So this half registers
    // the `myampix_analytics/attribution` channel purely to keep the Dart
    // `EventChannel` well-formed, and NEVER emits: iOS attribution is
    // deep-link-only via `MyAmpix.trackDeepLink`. This mirrors the honest
    // Play-Billing caveat documented on the purchase channel above.
    let attributionChannel = FlutterEventChannel(
      name: attributionChannelName,
      binaryMessenger: registrar.messenger()
    )
    attributionChannel.setStreamHandler(MyampixAttributionNoopStreamHandler())
  }

  deinit {
    SKPaymentQueue.default().remove(self)
  }

  // MARK: - FlutterStreamHandler

  public func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
    eventSink = events
    if !pendingPayloads.isEmpty {
      pendingPayloads.forEach { events($0) }
      pendingPayloads.removeAll()
    }
    return nil
  }

  public func onCancel(withArguments arguments: Any?) -> FlutterError? {
    eventSink = nil
    return nil
  }

  // MARK: - SKPaymentTransactionObserver

  /// Only `.purchased` is forwarded. `.restored` is deliberately NOT: it is
  /// what `restoreCompletedTransactions()` replays after a login or a
  /// reinstall, and for an auto-renewable subscription that replay is the
  /// product's ENTIRE billing history at once. Those are not sales — the
  /// money was already reported when each renewal originally came through as
  /// `.purchased` — so counting them would inflate revenue by however many
  /// periods the subscriber has been paying.
  ///
  /// This is only half the guard. StoreKit also re-delivers `.purchased`
  /// transactions to every newly attached observer, so a plain cold start
  /// replays them too; the Dart side (`PurchaseAutocapture`) holds the
  /// persisted seen-transaction set that makes each one emit exactly once.
  public func paymentQueue(_ queue: SKPaymentQueue, updatedTransactions transactions: [SKPaymentTransaction]) {
    for transaction in transactions {
      switch transaction.transactionState {
      case .purchased:
        forward(transaction)
        maybeFetchProduct(for: transaction.payment.productIdentifier)
      default:
        break
      }
    }
  }

  private func forward(_ transaction: SKPaymentTransaction) {
    let productId = transaction.payment.productIdentifier
    // `transactionIdentifier` is per-transaction, so each subscription
    // renewal keeps its own id and reports its own revenue — unlike
    // `original.transactionIdentifier`, which every renewal of a
    // subscription shares and which is therefore only a last-resort
    // fallback, never the primary key.
    let transactionId = transaction.transactionIdentifier ?? transaction.original?.transactionIdentifier
    guard !productId.isEmpty, let transactionId = transactionId, !transactionId.isEmpty else {
      // Never forward a payload the Dart side cannot map onto the §4
      // contract's required properties.
      return
    }
    let cached = productCache[productId]
    let payload: [String: Any?] = [
      "productId": productId,
      "price": cached?.price,
      "currency": cached?.currency,
      "quantity": transaction.payment.quantity,
      "transactionId": transactionId,
      "store": "app_store",
    ]
    if let sink = eventSink {
      sink(payload)
    } else {
      pendingPayloads.append(payload)
    }
  }

  private func maybeFetchProduct(for productId: String) {
    guard productCache[productId] == nil, !pendingProductRequests.contains(productId) else { return }
    pendingProductRequests.insert(productId)
    let request = SKProductsRequest(productIdentifiers: [productId])
    request.delegate = self
    productIdsByRequest[ObjectIdentifier(request)] = [productId]
    request.start()
  }

  // MARK: - SKProductsRequestDelegate

  public func productsRequest(_ request: SKProductsRequest, didReceive response: SKProductsResponse) {
    let requestedIds = productIdsByRequest.removeValue(forKey: ObjectIdentifier(request)) ?? []
    for product in response.products {
      pendingProductRequests.remove(product.productIdentifier)
      productCache[product.productIdentifier] = (
        price: product.price.doubleValue,
        currency: product.priceLocale.currencyCode
      )
    }
    for id in requestedIds where productCache[id] == nil {
      pendingProductRequests.remove(id)
    }
  }

  public func request(_ request: SKRequest, didFailWithError error: Error) {
    // Best-effort only: leave price/currency nil for these products next
    // time they're forwarded. Never crash on a products-request failure.
    guard let productsRequest = request as? SKProductsRequest else { return }
    let requestedIds = productIdsByRequest.removeValue(forKey: ObjectIdentifier(productsRequest)) ?? []
    requestedIds.forEach { pendingProductRequests.remove($0) }
  }
}

/// No-op stream handler for the `myampix_analytics/attribution` channel on
/// iOS. iOS has no install-referrer equivalent, so this handler accepts the
/// Dart listener and never emits — iOS marketing attribution is deep-link
/// only via `MyAmpix.trackDeepLink`. See the caveat in
/// `MyampixAnalyticsPlugin.register`.
private class MyampixAttributionNoopStreamHandler: NSObject, FlutterStreamHandler {
  func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
    // Intentionally emits nothing.
    return nil
  }

  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    return nil
  }
}
