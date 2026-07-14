import 'package:flutter/material.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import '../models/product.dart';
import '../state/event_log.dart';
import 'product_detail_screen.dart';

/// Category screen, pushed from the catalog (`catalog/category`) — a nested
/// page that filters the catalog to one category.
///
/// SDK calls: `track('category_viewed')` on load, `track('product_clicked')`
/// on tap (same event as the catalog list, distinguished by the `source`
/// property).
class CategoryScreen extends StatefulWidget {
  const CategoryScreen({super.key, required this.category});

  final String category;

  @override
  State<CategoryScreen> createState() => _CategoryScreenState();
}

class _CategoryScreenState extends State<CategoryScreen> {
  late final List<Product> _products = demoProducts
      .where((product) => product.category == widget.category)
      .toList();

  @override
  void initState() {
    super.initState();
    final properties = {
      'category': widget.category,
      'product_count': _products.length,
    };
    MyAmpix.instance.track('category_viewed', properties: properties);
    EventLog.instance.log('track("category_viewed")', properties);
  }

  void _openProduct(Product product) {
    final properties = {
      'product_id': product.id,
      'name': product.name,
      'price': product.price,
      'source': 'category',
    };
    MyAmpix.instance.track('product_clicked', properties: properties);
    EventLog.instance.log('track("product_clicked")', properties);
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        // Same stable "product_detail" screen name as the catalog path: the
        // layout is identical, so it should stay ONE screen in the dashboard
        // no matter how the user got there.
        settings: const RouteSettings(name: 'product_detail'),
        builder: (_) => ProductDetailScreen(product: product),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.category)),
      body: ListView.separated(
        itemCount: _products.length,
        separatorBuilder: (context, index) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final product = _products[index];
          return ListTile(
            title: Text(product.name),
            subtitle: Text(product.description),
            trailing: Text('\$${product.price.toStringAsFixed(2)}'),
            onTap: () => _openProduct(product),
          );
        },
      ),
    );
  }
}
