import 'enums.dart';
import 'store_product.dart';

/// One purchasable package inside an [Offering] (spec §3). `offeringIdentifier`
/// is injected from the parent offering (the server package object has no such
/// field).
class Package {
  const Package({
    required this.identifier,
    required this.packageType,
    required this.storeProduct,
    required this.offeringIdentifier,
  });

  factory Package.fromJson(
    Map<String, dynamic> json, {
    required String offeringIdentifier,
  }) =>
      Package(
        identifier: json['identifier'] as String,
        packageType: PackageType.fromWire(json['packageType'] as String?),
        storeProduct:
            StoreProduct.fromJson(json['product'] as Map<String, dynamic>),
        offeringIdentifier: offeringIdentifier,
      );

  final String identifier;
  final PackageType packageType;
  final StoreProduct storeProduct;
  final String offeringIdentifier;

  Map<String, Object?> toJson() => {
        'identifier': identifier,
        'packageType': packageType.wire,
        'product': storeProduct.toJson(),
      };
}
