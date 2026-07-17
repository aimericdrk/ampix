import 'models/offering.dart';
import 'models/offerings.dart';
import 'models/package.dart';
import 'network/purchases_api_client.dart';
import 'store/store_channel.dart';

/// Fetches offerings from `mobile_purchase` and enriches each package's
/// [StoreProduct] with native store metadata (design §4). The server ships
/// the catalog fields (priceCents/currency/durationIso8601); the native
/// layer supplies the localized priceString/title/description/period —
/// merged on top via [StoreProduct.copyWith]. When the native side returns
/// nothing for a product, the server-parsed values are left untouched.
/// Cached in memory after the first successful fetch.
class OfferingsService {
  OfferingsService({
    required PurchasesApiClient apiClient,
    required StoreChannel store,
  })  : _apiClient = apiClient,
        _store = store;

  final PurchasesApiClient _apiClient;
  final StoreChannel _store;

  Offerings? _cache;

  Future<Offerings> getOfferings() async {
    final cached = _cache;
    if (cached != null) return cached;
    final offerings = await _enrich(await _apiClient.getOfferings());
    _cache = offerings;
    return offerings;
  }

  Future<Offerings> _enrich(Offerings offerings) async {
    final current = offerings.current;
    if (current == null) return offerings;

    final ids = <String>{
      for (final package in current.availablePackages)
        package.storeProduct.identifier,
    }.toList();
    if (ids.isEmpty) return offerings;

    final metadataById = <String, StoreProductMetadata>{
      for (final metadata in await _store.getProducts(ids))
        metadata.storeProductId: metadata,
    };
    if (metadataById.isEmpty) return offerings;

    final enrichedOffering = Offering(
      identifier: current.identifier,
      metadata: current.metadata,
      availablePackages: [
        for (final package in current.availablePackages)
          _enrichPackage(package, metadataById[package.storeProduct.identifier]),
      ],
    );
    return Offerings(
      all: {enrichedOffering.identifier: enrichedOffering},
      current: enrichedOffering,
    );
  }

  Package _enrichPackage(Package package, StoreProductMetadata? metadata) {
    if (metadata == null) return package;
    return Package(
      identifier: package.identifier,
      packageType: package.packageType,
      offeringIdentifier: package.offeringIdentifier,
      storeProduct: package.storeProduct.copyWith(
        priceString: metadata.priceString,
        price: metadata.price,
        currencyCode: metadata.currencyCode,
        title: metadata.title,
        description: metadata.description,
        subscriptionPeriod: metadata.subscriptionPeriodIso8601,
      ),
    );
  }
}
