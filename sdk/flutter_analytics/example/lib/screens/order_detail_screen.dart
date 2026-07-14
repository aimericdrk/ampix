import 'package:flutter/material.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import '../state/event_log.dart';
import 'order_history_screen.dart';

/// Order detail (`profile/orders/detail`), the deepest page under the
/// Profile tab.
///
/// SDK calls: `track('order_viewed')` on load; `track('reorder_clicked')`
/// on "Buy again".
class OrderDetailScreen extends StatefulWidget {
  const OrderDetailScreen({super.key, required this.order});

  final DemoOrder order;

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  @override
  void initState() {
    super.initState();
    final properties = {
      'order_id': widget.order.id,
      'value': widget.order.total,
      'items': widget.order.items.length,
    };
    MyAmpix.instance.track('order_viewed', properties: properties);
    EventLog.instance.log('track("order_viewed")', properties);
  }

  void _reorder() {
    final properties = {
      'order_id': widget.order.id,
      'value': widget.order.total,
    };
    MyAmpix.instance.track('reorder_clicked', properties: properties);
    EventLog.instance.log('track("reorder_clicked")', properties);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Items added back to your cart (demo)')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final order = widget.order;
    return Scaffold(
      appBar: AppBar(title: Text(order.id)),
      body: ListView(
        children: [
          ListTile(
            title: const Text('Ordered on'),
            trailing: Text(order.date),
          ),
          const Divider(),
          for (final item in order.items)
            ListTile(
              leading: const Icon(Icons.inventory_2_outlined),
              title: Text(item),
            ),
          const Divider(),
          ListTile(
            title: const Text(
              'Total',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            trailing: Text(
              '\$${order.total.toStringAsFixed(2)}',
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton.icon(
            onPressed: _reorder,
            icon: const Icon(Icons.replay),
            label: const Text('Buy again'),
          ),
        ),
      ),
    );
  }
}
