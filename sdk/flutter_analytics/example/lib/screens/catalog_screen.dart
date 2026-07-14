import 'package:flutter/material.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import '../models/product.dart';
import '../state/event_log.dart';
import 'category_screen.dart';
import 'deals_screen.dart';
import 'product_detail_screen.dart';
import 'search_screen.dart';
import 'wishlist_screen.dart';

/// Catalog screen: lists the hardcoded demo products, plus entry points into
/// the nested Search, Wishlist, Deals and Category pages.
///
/// SDK calls: `track('catalog_viewed')` on load, `track('product_clicked')`
/// on tap, `track('promo_banner_clicked')` on the deals banner.
class CatalogScreen extends StatefulWidget {
  const CatalogScreen({super.key});

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen> {
  @override
  void initState() {
    super.initState();
    final properties = {'product_count': demoProducts.length};
    MyAmpix.instance.track('catalog_viewed', properties: properties);
    EventLog.instance.log('track("catalog_viewed")', properties);
  }

  void _openProduct(Product product) {
    final properties = {
      'product_id': product.id,
      'name': product.name,
      'price': product.price,
      'source': 'catalog',
    };
    MyAmpix.instance.track('product_clicked', properties: properties);
    EventLog.instance.log('track("product_clicked")', properties);
    Navigator.of(context).push<void>(
      // Naming the route gives MyAmpixObserver a meaningful `$screen_name`
      // ("product_detail") instead of the useless "MaterialPageRoute<void>".
      MaterialPageRoute(
        settings: const RouteSettings(name: 'product_detail'),
        builder: (_) => ProductDetailScreen(product: product),
      ),
    );
  }

  void _openCategory(String category) {
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        // Slash-separated names give the dashboard a page HIERARCHY:
        // "catalog/category" nests under the catalog tab.
        settings: const RouteSettings(name: 'catalog/category'),
        builder: (_) => CategoryScreen(category: category),
      ),
    );
  }

  void _openSearch() {
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        settings: const RouteSettings(name: 'catalog/search'),
        builder: (_) => const SearchScreen(),
      ),
    );
  }

  void _openWishlist() {
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        settings: const RouteSettings(name: 'catalog/wishlist'),
        builder: (_) => const WishlistScreen(),
      ),
    );
  }

  void _openDeals() {
    MyAmpix.instance.track('promo_banner_clicked');
    EventLog.instance.log('track("promo_banner_clicked")');
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        settings: const RouteSettings(name: 'catalog/deals'),
        builder: (_) => const DealsScreen(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Catalog'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            tooltip: 'Search',
            onPressed: _openSearch,
          ),
          IconButton(
            icon: const Icon(Icons.favorite_border),
            tooltip: 'Wishlist',
            onPressed: _openWishlist,
          ),
        ],
      ),
      body: ListView(
        children: [
          // Promo banner → nested Deals page.
          Padding(
            padding: const EdgeInsets.all(12),
            child: Card(
              color: Theme.of(context).colorScheme.primaryContainer,
              child: ListTile(
                leading: const Icon(Icons.local_offer),
                title: const Text('Summer deals — up to 20% off'),
                trailing: const Icon(Icons.chevron_right),
                onTap: _openDeals,
              ),
            ),
          ),
          // Category chips → nested Category pages.
          SizedBox(
            height: 48,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                for (final category in demoCategories())
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ActionChip(
                      label: Text(category),
                      onPressed: () => _openCategory(category),
                    ),
                  ),
              ],
            ),
          ),
          const Divider(),
          for (final product in demoProducts) ...[
            ListTile(
              title: Text(product.name),
              subtitle: Text(product.description),
              trailing: Text('\$${product.price.toStringAsFixed(2)}'),
              onTap: () => _openProduct(product),
            ),
            const Divider(height: 1),
          ],
        ],
      ),
    );
  }
}
