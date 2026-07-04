import 'package:flutter/material.dart';
import 'package:myampmix_analytics/myampmix_analytics.dart';

import '../models/product.dart';
import '../state/cart_state.dart';
import '../state/event_log.dart';

/// Product detail screen.
///
/// SDK calls: `track('product_viewed')` on load; `track('add_to_cart')` +
/// `people.increment({'cart_items': 1})` on "Add to cart".
class ProductDetailScreen extends StatefulWidget {
  const ProductDetailScreen({super.key, required this.product});

  final Product product;

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  @override
  void initState() {
    super.initState();
    final product = widget.product;
    final properties = {
      'product_id': product.id,
      'name': product.name,
      'price': product.price,
    };
    MyAmpMix.instance.track('product_viewed', properties: properties);
    EventLog.instance.log('track("product_viewed")', properties);
  }

  void _addToCart() {
    final product = widget.product;
    final properties = {
      'product_id': product.id,
      'name': product.name,
      'price': product.price,
    };
    MyAmpMix.instance.track('add_to_cart', properties: properties);
    MyAmpMix.instance.people.increment({'cart_items': 1});
    CartState.instance.add(product);
    EventLog.instance.log(
      'track("add_to_cart") + people.increment({"cart_items": 1})',
      properties,
    );
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('${product.name} added to cart')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final product = widget.product;
    return Scaffold(
      appBar: AppBar(title: Text(product.name)),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(product.name, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 8),
            Text(
              '\$${product.price.toStringAsFixed(2)}',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 16),
            Text(product.description),
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
  }
}
