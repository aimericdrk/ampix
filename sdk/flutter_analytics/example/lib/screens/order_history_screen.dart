import 'package:flutter/material.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import '../state/event_log.dart';
import 'order_detail_screen.dart';

/// A hardcoded past order for the demo Profile > Orders flow.
class DemoOrder {
  const DemoOrder({
    required this.id,
    required this.date,
    required this.total,
    required this.items,
  });

  final String id;
  final String date;
  final double total;
  final List<String> items;
}

const List<DemoOrder> demoOrders = [
  DemoOrder(
    id: 'ORD-1042',
    date: '2026-07-01',
    total: 148.99,
    items: ['Wireless Headphones', 'Espresso Grinder'],
  ),
  DemoOrder(
    id: 'ORD-1017',
    date: '2026-06-14',
    total: 129.00,
    items: ['Mechanical Keyboard'],
  ),
  DemoOrder(
    id: 'ORD-0991',
    date: '2026-05-30',
    total: 108.99,
    items: ['Running Shoes', 'Smart Water Bottle'],
  ),
];

/// Order history, pushed from Profile (`profile/orders`) — a nested page
/// under a bottom tab.
///
/// SDK calls: `track('order_history_viewed')` on load.
class OrderHistoryScreen extends StatefulWidget {
  const OrderHistoryScreen({super.key});

  @override
  State<OrderHistoryScreen> createState() => _OrderHistoryScreenState();
}

class _OrderHistoryScreenState extends State<OrderHistoryScreen> {
  @override
  void initState() {
    super.initState();
    final properties = {'order_count': demoOrders.length};
    MyAmpix.instance.track('order_history_viewed', properties: properties);
    EventLog.instance.log('track("order_history_viewed")', properties);
  }

  void _openOrder(DemoOrder order) {
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        // Second nesting level under the Profile tab:
        // profile > orders > detail.
        settings: const RouteSettings(name: 'profile/orders/detail'),
        builder: (_) => OrderDetailScreen(order: order),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Order history')),
      body: ListView.separated(
        itemCount: demoOrders.length,
        separatorBuilder: (context, index) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final order = demoOrders[index];
          return ListTile(
            title: Text(order.id),
            subtitle: Text('${order.date} — ${order.items.length} item(s)'),
            trailing: Text('\$${order.total.toStringAsFixed(2)}'),
            onTap: () => _openOrder(order),
          );
        },
      ),
    );
  }
}
