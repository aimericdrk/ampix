import 'enums.dart';

/// A purchasable store product (spec §3). Built from the server `product`
/// object; `priceString`/`price`/`currencyCode`/`title`/`description` are
/// server fallbacks until the native layer enriches them via [copyWith]
/// (spec §4). Dates are not present here — subscription length is the ISO-8601
/// [subscriptionPeriod] string.
class StoreProduct {
  const StoreProduct({
    required this.identifier,
    required this.productType,
    required this.priceString,
    required this.price,
    required this.currencyCode,
    this.subscriptionPeriod,
    this.title = '',
    this.description = '',
    this.entitlementIdentifiers = const [],
  });

  /// Parses the server `product` object: `{ storeProductId, type, priceCents,
  /// currency, durationIso8601, entitlements }`.
  factory StoreProduct.fromJson(Map<String, dynamic> json) {
    final priceCents = json['priceCents'] as int?;
    final price = priceCents == null ? 0.0 : priceCents / 100.0;
    return StoreProduct(
      identifier: json['storeProductId'] as String,
      productType: ProductType.fromWire(json['type'] as String?),
      price: price,
      priceString: price.toStringAsFixed(2),
      currencyCode: (json['currency'] as String?) ?? '',
      subscriptionPeriod: json['durationIso8601'] as String?,
      entitlementIdentifiers:
          ((json['entitlements'] as List<dynamic>?) ?? const <dynamic>[])
              .cast<String>(),
    );
  }

  final String identifier;
  final ProductType productType;
  final String priceString;
  final double price;
  final String currencyCode;
  final String? subscriptionPeriod;
  final String title;
  final String description;
  final List<String> entitlementIdentifiers;

  /// Returns a copy with native store metadata merged over the server fallback
  /// (spec §4's `getProducts` enrichment). Omitted fields keep their value.
  StoreProduct copyWith({
    String? priceString,
    double? price,
    String? currencyCode,
    String? title,
    String? description,
    String? subscriptionPeriod,
  }) =>
      StoreProduct(
        identifier: identifier,
        productType: productType,
        priceString: priceString ?? this.priceString,
        price: price ?? this.price,
        currencyCode: currencyCode ?? this.currencyCode,
        subscriptionPeriod: subscriptionPeriod ?? this.subscriptionPeriod,
        title: title ?? this.title,
        description: description ?? this.description,
        entitlementIdentifiers: entitlementIdentifiers,
      );

  Map<String, Object?> toJson() => {
        'identifier': identifier,
        'productType': productType.wire,
        'priceString': priceString,
        'price': price,
        'currencyCode': currencyCode,
        'subscriptionPeriod': subscriptionPeriod,
        'title': title,
        'description': description,
        'entitlementIdentifiers': entitlementIdentifiers,
      };
}
