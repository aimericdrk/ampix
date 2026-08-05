import 'enums.dart';
import 'package.dart';

/// A named group of packages the app can display (spec §3). Built from the
/// server's `current` object `{ identifier, metadata, packages }`.
class Offering {
  const Offering({
    required this.identifier,
    required this.metadata,
    required this.availablePackages,
  });

  factory Offering.fromJson(Map<String, dynamic> json) {
    final identifier = json['identifier'] as String;
    final packagesJson =
        (json['packages'] as List<dynamic>?) ?? const <dynamic>[];
    return Offering(
      identifier: identifier,
      metadata: Map<String, Object?>.from(
        (json['metadata'] as Map?) ?? const <String, Object?>{},
      ),
      availablePackages: [
        for (final p in packagesJson.cast<Map<String, dynamic>>())
          Package.fromJson(p, offeringIdentifier: identifier),
      ],
    );
  }

  final String identifier;
  final Map<String, Object?> metadata;
  final List<Package> availablePackages;

  Package? get lifetime => _ofType(PackageType.lifetime);
  Package? get annual => _ofType(PackageType.annual);
  Package? get sixMonth => _ofType(PackageType.sixMonth);
  Package? get threeMonth => _ofType(PackageType.threeMonth);
  Package? get twoMonth => _ofType(PackageType.twoMonth);
  Package? get monthly => _ofType(PackageType.monthly);
  Package? get weekly => _ofType(PackageType.weekly);

  Package? _ofType(PackageType type) {
    for (final p in availablePackages) {
      if (p.packageType == type) return p;
    }
    return null;
  }

  Map<String, Object?> toJson() => {
        'identifier': identifier,
        'metadata': metadata,
        'packages': [for (final p in availablePackages) p.toJson()],
      };
}
