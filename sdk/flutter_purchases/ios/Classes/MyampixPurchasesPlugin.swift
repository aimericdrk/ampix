import Flutter
import StoreKit

/// MyAmpix Flutter purchases SDK — native iOS half (StoreKit 2).
///
/// Answers the `myampix_purchases/methods` MethodChannel (Dart → native store
/// operations) and pushes out-of-band transactions onto the
/// `myampix_purchases/transactions` EventChannel (native → Dart). It performs
/// STORE OPERATIONS ONLY: fetch products, run purchases, surface the StoreKit 2
/// `jwsRepresentation` receipt, stream `Transaction.updates`, finish
/// transactions after the Dart layer confirms the server granted, and replay
/// `Transaction.currentEntitlements` for restore. It holds NO server URL/key
/// and does NO HTTP — all networking, the CustomerInfo model, identity and
/// orchestration live in Dart (design §1/§5).
///
/// Defensive by construction: every StoreKit call is wrapped so a failure maps
/// to a typed `FlutterError` (never a crash into the host), and payloads Dart
/// could not map onto the §5 contract are dropped rather than forwarded.
public class MyampixPurchasesPlugin: NSObject, FlutterPlugin, FlutterStreamHandler {
  private static let methodChannelName = "myampix_purchases/methods"
  private static let eventChannelName = "myampix_purchases/transactions"

  private var eventSink: FlutterEventSink?

  /// Transactions observed before Dart attaches its EventChannel listener
  /// (e.g. a renewal replayed at cold start, before `runApp`) are buffered here
  /// and flushed on `onListen`, so nothing is silently dropped.
  private var pendingPayloads: [[String: Any?]] = []

  /// Long-lived task draining `Transaction.updates` (renewals, interrupted
  /// purchases, revocations) onto the EventChannel. Started in `register`,
  /// cancelled in `deinit`.
  private var updatesTask: Task<Void, Never>?

  deinit {
    updatesTask?.cancel()
  }

  public static func register(with registrar: FlutterPluginRegistrar) {
    let instance = MyampixPurchasesPlugin()

    let methodChannel = FlutterMethodChannel(
      name: methodChannelName,
      binaryMessenger: registrar.messenger()
    )
    registrar.addMethodCallDelegate(instance, channel: methodChannel)

    let eventChannel = FlutterEventChannel(
      name: eventChannelName,
      binaryMessenger: registrar.messenger()
    )
    eventChannel.setStreamHandler(instance)

    // Keep the instance alive for the engine's lifetime so the long-lived
    // Transaction.updates task (attached below) is never deallocated.
    registrar.publish(instance)

    // Attach the out-of-band transaction listener (renewals, restores
    // completed out of band, interrupted purchases). Design §4.
    instance.startTransactionUpdates()
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

  // MARK: - Emit / result helpers (always hop to main for Flutter calls)

  func emit(_ payload: [String: Any?]) {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      if let sink = self.eventSink {
        sink(payload)
      } else {
        self.pendingPayloads.append(payload)
      }
    }
  }

  func succeed(_ result: @escaping FlutterResult, _ value: Any?) {
    DispatchQueue.main.async { result(value) }
  }

  func fail(_ result: @escaping FlutterResult, _ code: String, _ message: String, _ details: String? = nil) {
    DispatchQueue.main.async { result(FlutterError(code: code, message: message, details: details)) }
  }

  // MARK: - FlutterPlugin dispatch

  public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "canMakePayments":
      // Static, synchronous StoreKit 2 gate — no async hop needed.
      result(AppStore.canMakePayments)
    case "getProducts":
      handleGetProducts(call, result: result)
    case "purchase":
      handlePurchase(call, result: result)
    case "finishTransaction":
      handleFinishTransaction(call, result: result)
    case "restore":
      handleRestore(call, result: result)
    default:
      result(FlutterMethodNotImplemented)
    }
  }
}

// MARK: - getProducts

extension MyampixPurchasesPlugin {
  func handleGetProducts(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    let args = call.arguments as? [String: Any]
    let ids = (args?["productIds"] as? [String]) ?? []
    guard !ids.isEmpty else {
      succeed(result, [])
      return
    }
    Task { [weak self] in
      guard let self = self else { return }
      do {
        // `Product.products(for:)` already omits ids the store cannot resolve,
        // which satisfies the "products not found are omitted" clause of §5.
        let products = try await Product.products(for: ids)
        let payloads = products.map { self.productPayload($0) }
        self.succeed(result, payloads)
      } catch {
        self.fail(result, "storeProblem", "Failed to load products", "\(error)")
      }
    }
  }

  func productPayload(_ product: Product) -> [String: Any?] {
    var map: [String: Any?] = [
      "storeProductId": product.id,
      "priceString": product.displayPrice,
      // StoreKit 2 `price` is a Decimal in MAJOR currency units (e.g. 9.99).
      // The unified §5 "micros→double" note is the Android convention; iOS
      // returns the plain major-unit double and Dart merges it directly.
      "price": NSDecimalNumber(decimal: product.price).doubleValue,
      "currencyCode": product.priceFormatStyle.locale.currencyCode ?? "",
      "title": product.displayName,
      "description": product.description,
      "subscriptionPeriodIso8601": nil,
    ]
    if let period = product.subscription?.subscriptionPeriod {
      map["subscriptionPeriodIso8601"] = Self.iso8601Duration(period)
    }
    return map
  }

  /// Maps a StoreKit 2 subscription period to an ISO-8601 duration string
  /// (`P1W`/`P1M`/`P1Y`/`P3D`), matching the server's `durationIso8601`.
  static func iso8601Duration(_ period: Product.SubscriptionPeriod) -> String {
    let n = period.value
    switch period.unit {
    case .day: return "P\(n)D"
    case .week: return "P\(n)W"
    case .month: return "P\(n)M"
    case .year: return "P\(n)Y"
    @unknown default: return "P\(n)D"
    }
  }
}

// MARK: - purchase

extension MyampixPurchasesPlugin {
  func handlePurchase(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    let args = call.arguments as? [String: Any]
    guard let storeProductId = args?["storeProductId"] as? String, !storeProductId.isEmpty else {
      fail(result, "storeProblem", "Missing storeProductId")
      return
    }
    let tokenString = args?["appAccountToken"] as? String
    Task { [weak self] in
      guard let self = self else { return }
      do {
        let products = try await Product.products(for: [storeProductId])
        guard let product = products.first else {
          self.fail(result, "productNotAvailable", "Product \(storeProductId) is not available")
          return
        }

        // Self-attribution: bind the App Store transaction to our app-user-id
        // (the Dart layer passes uuidFor(appUserId)). appAccountToken must be
        // a valid UUID; if Dart ever sends a non-UUID we simply purchase
        // without the option rather than fail the whole purchase.
        var options: Set<Product.PurchaseOption> = []
        if let tokenString = tokenString, let uuid = UUID(uuidString: tokenString) {
          options.insert(.appAccountToken(uuid))
        }

        let purchaseResult = try await product.purchase(options: options)
        switch purchaseResult {
        case .success(let verification):
          // Forward the signed JWS receipt to Dart; the server re-verifies it.
          // The transaction is deliberately LEFT UNFINISHED — Dart calls
          // finishTransaction only AFTER mobile_purchase grants (design §4). A
          // crash between store-success and server-grant therefore re-delivers
          // the transaction via Transaction.updates (Task 3.5.4) instead of
          // losing the purchase.
          // Include the transactionId so Dart finishes it in-session right after
          // the server grants (design §4 step 4) and populates
          // PurchaseResult.storeTransaction — rather than deferring the finish to
          // the next launch's Transaction.updates redelivery.
          self.succeed(result, [
            "platform": "APP_STORE",
            "fetchToken": verification.jwsRepresentation,
            "storeProductId": product.id,
            "transactionId": String(verification.unsafePayloadValue.id),
          ])
        case .userCancelled:
          self.fail(result, "userCancelled", "Purchase cancelled by the user")
        case .pending:
          self.fail(result, "paymentPending", "Purchase is pending (e.g. Ask to Buy / SCA)")
        @unknown default:
          self.fail(result, "storeProblem", "Unknown purchase result")
        }
      } catch {
        self.failPurchase(result, error)
      }
    }
  }

  /// Maps a thrown StoreKit 2 error to the §6 FlutterError code contract.
  func failPurchase(_ result: @escaping FlutterResult, _ error: Error) {
    if let skError = error as? StoreKitError {
      switch skError {
      case .userCancelled:
        fail(result, "userCancelled", "Purchase cancelled by the user")
      case .notAvailableInStorefront:
        fail(result, "productNotAvailable", "Product not available in this storefront", "\(skError)")
      default:
        fail(result, "storeProblem", "StoreKit error", "\(skError)")
      }
      return
    }
    if let purchaseError = error as? Product.PurchaseError {
      switch purchaseError {
      case .productUnavailable:
        fail(result, "productNotAvailable", "Product unavailable for purchase", "\(purchaseError)")
      default:
        fail(result, "storeProblem", "Purchase failed", "\(purchaseError)")
      }
      return
    }
    fail(result, "storeProblem", "Purchase failed", "\(error)")
  }
}

// MARK: - Transaction.updates stream + finishTransaction

extension MyampixPurchasesPlugin {
  /// Drains `Transaction.updates` for the app's lifetime. Every out-of-band
  /// transaction (renewal, interrupted purchase completed later, family-share
  /// grant) is forwarded to Dart, which POSTs it to /v1/receipts and refreshes
  /// CustomerInfo. This is how a renewal detected on-device reaches the server
  /// even without a store→server webhook (design §4 "Out-of-band transactions").
  func startTransactionUpdates() {
    guard updatesTask == nil else { return }
    updatesTask = Task.detached { [weak self] in
      for await verification in Transaction.updates {
        guard let self = self else { return }
        // The server re-verifies the JWS, so we forward the payload without
        // failing on `.unverified`; `unsafePayloadValue` only reads the id.
        let transaction = verification.unsafePayloadValue
        self.emit([
          "platform": "APP_STORE",
          "fetchToken": verification.jwsRepresentation,
          "storeProductId": transaction.productID,
          "transactionId": String(transaction.id),
          "reason": "renewal",
        ])
      }
    }
  }

  /// Finishes a transaction after the Dart layer confirmed the server granted
  /// (design §4 step 4). Scans `Transaction.unfinished` for the matching id so
  /// it works even across app restarts (no in-memory transaction cache needed).
  func handleFinishTransaction(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    let args = call.arguments as? [String: Any]
    guard let transactionId = args?["transactionId"] as? String, !transactionId.isEmpty else {
      // Malformed input is an ack no-op, never a crash.
      succeed(result, nil)
      return
    }
    Task { [weak self] in
      guard let self = self else { return }
      for await verification in Transaction.unfinished {
        let transaction = verification.unsafePayloadValue
        if String(transaction.id) == transactionId {
          await transaction.finish()
          break
        }
      }
      self.succeed(result, nil)
    }
  }
}

// MARK: - restore (Transaction.currentEntitlements)

extension MyampixPurchasesPlugin {
  /// Replays the user's current entitlements onto the EventChannel. Per §5
  /// `restore()` has NO direct return — it acks immediately and each active
  /// entitlement is pushed as a `reason: "restore"` event, which Dart binds to
  /// the current app-user-id by POSTing to /v1/receipts (design §4
  /// `restorePurchases()`), then refetches CustomerInfo.
  ///
  /// final-review I-1: because this ack is immediate and the entitlements
  /// above are pushed asynchronously afterward, Dart cannot tell "the replay
  /// is done" from the `restore()` method result alone. Once
  /// `Transaction.currentEntitlements` is exhausted, emit one more
  /// `reason: "restore_complete"` sentinel on the SAME EventChannel — Dart's
  /// `restorePurchases()` waits for it (see `PurchaseController`) instead of
  /// a fixed delay, which is correct regardless of how long the replay above
  /// takes on a real device.
  func handleRestore(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    succeed(result, nil)
    Task { [weak self] in
      guard let self = self else { return }
      for await verification in Transaction.currentEntitlements {
        let transaction = verification.unsafePayloadValue
        self.emit([
          "platform": "APP_STORE",
          "fetchToken": verification.jwsRepresentation,
          "storeProductId": transaction.productID,
          "transactionId": String(transaction.id),
          "reason": "restore",
        ])
      }
      self.emit(["reason": "restore_complete"])
    }
  }
}
