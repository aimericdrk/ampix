import 'package:flutter/material.dart';
import 'package:myampmix_analytics/myampmix_analytics.dart';

import '../models/product.dart';
import '../state/event_log.dart';
import 'product_detail_screen.dart';

/// Catalog screen: lists the hardcoded demo products.
///
/// SDK calls: `track('catalog_viewed')` on load, `track('product_clicked')`
/// on tap.
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
    MyAmpMix.instance.track('catalog_viewed', properties: properties);
    EventLog.instance.log('track("catalog_viewed")', properties);
  }

  void _openProduct(Product product) {
    final properties = {
      'product_id': product.id,
      'name': product.name,
      'price': product.price,
    };
    MyAmpMix.instance.track('product_clicked', properties: properties);
    EventLog.instance.log('track("product_clicked")', properties);
    Navigator.of(context).push<void>(
      // Naming the route gives MyAmpMixObserver a meaningful `$screen_name`
      // ("product_detail") instead of the useless "MaterialPageRoute<void>".
      MaterialPageRoute(
        settings: const RouteSettings(name: 'product_detail'),
        builder: (_) => ProductDetailScreen(product: product),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Catalog')),
      body: ListView.separated(
        itemCount: demoProducts.length,
        separatorBuilder: (context, index) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final product = demoProducts[index];
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
