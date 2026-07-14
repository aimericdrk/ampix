import 'package:flutter/material.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import '../models/product.dart';
import '../state/event_log.dart';
import '../state/wishlist_state.dart';
import 'product_detail_screen.dart';

/// Wishlist screen, pushed from the catalog app bar (`catalog/wishlist`).
///
/// SDK calls: `track('wishlist_viewed')` on load; `track('product_clicked')`
/// with `source: 'wishlist'` on tap.
class WishlistScreen extends StatefulWidget {
  const WishlistScreen({super.key});

  @override
  State<WishlistScreen> createState() => _WishlistScreenState();
}

class _WishlistScreenState extends State<WishlistScreen> {
  @override
  void initState() {
    super.initState();
    final properties = {'item_count': WishlistState.instance.itemCount};
    MyAmpix.instance.track('wishlist_viewed', properties: properties);
    EventLog.instance.log('track("wishlist_viewed")', properties);
  }

  void _openProduct(Product product) {
    final properties = {
      'product_id': product.id,
      'name': product.name,
      'price': product.price,
      'source': 'wishlist',
    };
    MyAmpix.instance.track('product_clicked', properties: properties);
    EventLog.instance.log('track("product_clicked")', properties);
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        settings: const RouteSettings(name: 'product_detail'),
        builder: (_) => ProductDetailScreen(product: product),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: WishlistState.instance,
      builder: (context, _) {
        final wishlist = WishlistState.instance;
        return Scaffold(
          appBar: AppBar(title: const Text('Wishlist')),
          body: wishlist.items.isEmpty
              ? const Center(
                  child: Text(
                    'Your wishlist is empty.\nTap the heart on a product page.',
                    textAlign: TextAlign.center,
                  ),
                )
              : ListView.separated(
                  itemCount: wishlist.items.length,
                  separatorBuilder: (context, index) =>
                      const Divider(height: 1),
                  itemBuilder: (context, index) {
                    final product = wishlist.items[index];
                    return ListTile(
                      leading: const Icon(Icons.favorite, color: Colors.pink),
                      title: Text(product.name),
                      trailing: Text('\$${product.price.toStringAsFixed(2)}'),
                      onTap: () => _openProduct(product),
                    );
                  },
                ),
        );
      },
    );
  }
}
