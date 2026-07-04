import Flutter
import StoreKit
import UIKit

/// MyAmpMix native store-purchase autocapture (iOS half).
///
/// Registers an `SKPaymentTransactionObserver` on the shared, process-wide
/// `SKPaymentQueue` and forwards `.purchased`/`.restored` transactions to
/// Dart over the `myampmix_analytics/purchases` `EventChannel`. Consumed by
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
public class MyampmixAnalyticsPlugin: NSObject, FlutterPlugin, SKPaymentTransactionObserver, SKProductsRequestDelegate, FlutterStreamHandler {
  private static let channelName = "myampmix_analytics/purchases"

  private var eventSink: FlutterEventSink?

  /// Transactions observed before Dart attaches a stream listener (e.g. a
  /// restored transaction replayed at cold start, before `runApp`
  /// completes) are buffered here and flushed as soon as `onListen` runs,
  /// so nothing is silently dropped.
  private var pendingPayloads: [[String: Any?]] = []

  /// Best-effort product price/currency cache, keyed by productIdentifier.
  /// Populated asynchronously via `SKProductsRequest`; a transaction is
  /// forwarded immediately regardless of whether this cache is warm yet —
  /// price/currency are simply `nil` until/unless a lookup completes.
  private var productCache: [String: (price: Double, currency: String?)] = [:]
  private var pendingProductRequests: Set<String> = []
  private var productIdsByRequest: [ObjectIdentifier: [String]] = [:]

  public static func register(with registrar: FlutterPluginRegistrar) {
    let instance = MyampmixAnalyticsPlugin()
    let eventChannel = FlutterEventChannel(
      name: channelName,
      binaryMessenger: registrar.messenger()
    )
    eventChannel.setStreamHandler(instance)
    SKPaymentQueue.default().add(instance)
    // Keeps the plugin instance alive for the lifetime of the engine so the
    // SKPaymentQueue observer registration above is never deallocated.
    registrar.publish(instance)
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

  public func paymentQueue(_ queue: SKPaymentQueue, updatedTransactions transactions: [SKPaymentTransaction]) {
    for transaction in transactions {
      switch transaction.transactionState {
      case .purchased, .restored:
        forward(transaction)
        maybeFetchProduct(for: transaction.payment.productIdentifier)
      default:
        break
      }
    }
  }

  private func forward(_ transaction: SKPaymentTransaction) {
    let productId = transaction.payment.productIdentifier
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
