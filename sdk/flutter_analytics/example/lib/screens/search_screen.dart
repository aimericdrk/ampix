import 'package:flutter/material.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import '../models/product.dart';
import '../state/event_log.dart';
import 'product_detail_screen.dart';

/// Search screen, pushed from the catalog app bar (`catalog/search`).
///
/// SDK calls: `track('search_performed')` on every submitted query (with
/// `query` and `result_count`, so no-result searches are measurable), and
/// `track('product_clicked')` with `source: 'search'` on a result tap.
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _controller = TextEditingController();
  List<Product> _results = [];
  bool _searched = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _search(String rawQuery) {
    final query = rawQuery.trim().toLowerCase();
    if (query.isEmpty) return;
    final results = demoProducts
        .where(
          (product) =>
              product.name.toLowerCase().contains(query) ||
              product.description.toLowerCase().contains(query) ||
              product.category.toLowerCase().contains(query),
        )
        .toList();
    setState(() {
      _results = results;
      _searched = true;
    });
    final properties = {'query': query, 'result_count': results.length};
    MyAmpix.instance.track('search_performed', properties: properties);
    EventLog.instance.log('track("search_performed")', properties);
  }

  void _openProduct(Product product) {
    final properties = {
      'product_id': product.id,
      'name': product.name,
      'price': product.price,
      'source': 'search',
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
    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _controller,
          autofocus: true,
          textInputAction: TextInputAction.search,
          decoration: const InputDecoration(
            hintText: 'Search products…',
            border: InputBorder.none,
          ),
          onSubmitted: _search,
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () => _search(_controller.text),
          ),
        ],
      ),
      body: !_searched
          ? const Center(child: Text('Type a query and press search.'))
          : _results.isEmpty
          ? const Center(child: Text('No products found.'))
          : ListView.separated(
              itemCount: _results.length,
              separatorBuilder: (context, index) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final product = _results[index];
                return ListTile(
                  title: Text(product.name),
                  subtitle: Text(product.category),
                  trailing: Text('\$${product.price.toStringAsFixed(2)}'),
                  onTap: () => _openProduct(product),
                );
              },
            ),
    );
  }
}
