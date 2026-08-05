import 'package:flutter/material.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import '../models/product.dart';
import '../state/cart_state.dart';
import '../state/event_log.dart';
import '../state/wishlist_state.dart';
import 'reviews_screen.dart';

/// Product detail screen.
///
/// SDK calls: `track('product_viewed')` on load; `track('add_to_cart')` +
/// `people.increment({'cart_items': 1})` on "Add to cart";
/// `track('wishlist_toggled')` on the heart; `track('product_shared')` on
/// the share icon.
class ProductDetailScreen extends StatefulWidget {
  const ProductDetailScreen({super.key, required this.product});

  final Product product;

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  Map<String, Object?> get _baseProperties => {
    'product_id': widget.product.id,
    'name': widget.product.name,
    'price': widget.product.price,
  };

  @override
  void initState() {
    super.initState();
    final properties = _baseProperties;
    MyAmpix.instance.track('product_viewed', properties: properties);
    EventLog.instance.log('track("product_viewed")', properties);
  }

  void _addToCart() {
    final properties = _baseProperties;
    MyAmpix.instance.track('add_to_cart', properties: properties);
    MyAmpix.instance.people.increment({'cart_items': 1});
    CartState.instance.add(widget.product);
    EventLog.instance.log(
      'track("add_to_cart") + people.increment({"cart_items": 1})',
      properties,
    );
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('${widget.product.name} added to cart')),
    );
  }

  void _toggleWishlist() {
    final added = WishlistState.instance.toggle(widget.product);
    final properties = {..._baseProperties, 'added': added};
    MyAmpix.instance.track('wishlist_toggled', properties: properties);
    MyAmpix.instance.people.set({
      'wishlist_items': WishlistState.instance.itemCount,
    });
    EventLog.instance.log(
      'track("wishlist_toggled") + people.set({"wishlist_items": ...})',
      properties,
    );
  }

  void _share() {
    final properties = {..._baseProperties, 'channel': 'copy_link'};
    MyAmpix.instance.track('product_shared', properties: properties);
    EventLog.instance.log('track("product_shared")', properties);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Link copied to clipboard (demo)')),
    );
  }

  void _openReviews() {
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        // Nested one level deeper than product_detail — exercises multi-level
        // navigation hierarchies in the dashboard.
        settings: const RouteSettings(name: 'product_detail/reviews'),
        builder: (_) => ReviewsScreen(product: widget.product),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final product = widget.product;
    return AnimatedBuilder(
      animation: WishlistState.instance,
      builder: (context, _) {
        final wishlisted = WishlistState.instance.contains(product);
        return Scaffold(
          appBar: AppBar(
            title: Text(product.name),
            actions: [
              IconButton(
                icon: Icon(
                  wishlisted ? Icons.favorite : Icons.favorite_border,
                  color: wishlisted ? Colors.pink : null,
                ),
                tooltip: 'Wishlist',
                onPressed: _toggleWishlist,
              ),
              IconButton(
                icon: const Icon(Icons.share_outlined),
                tooltip: 'Share',
                onPressed: _share,
              ),
            ],
          ),
          body: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  product.name,
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 4),
                Chip(label: Text(product.category)),
                const SizedBox(height: 8),
                Text(
                  '\$${product.price.toStringAsFixed(2)}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 16),
                Text(product.description),
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: _openReviews,
                  icon: const Icon(Icons.reviews_outlined),
                  label: const Text('See reviews'),
                ),
                const Spacer(),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _addToCart,
                    child: const Text('Add to cart'),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
