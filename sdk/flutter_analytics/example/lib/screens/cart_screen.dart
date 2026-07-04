import 'package:flutter/material.dart';
import 'package:myampmix_analytics/myampmix_analytics.dart';

import '../state/cart_state.dart';
import '../state/event_log.dart';

/// Cart / checkout screen.
///
/// SDK calls: `timeEvent('checkout_completed')` on entering the screen;
/// `track('checkout_completed', properties: {...})` (the timed duration
/// auto-attaches) + `people.set({'last_purchase_value': ...})` on
/// "Complete purchase".
class CartScreen extends StatefulWidget {
  const CartScreen({super.key});

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  @override
  void initState() {
    super.initState();
    MyAmpMix.instance.timeEvent('checkout_completed');
    EventLog.instance.log('timeEvent("checkout_completed")');
  }

  void _completePurchase() {
    final cart = CartState.instance;
    final total = cart.total;
    final items = cart.itemCount;
    final properties = {'value': total, 'items': items};
    MyAmpMix.instance.track('checkout_completed', properties: properties);
    MyAmpMix.instance.people.set({'last_purchase_value': total});
    EventLog.instance.log(
      'track("checkout_completed") + people.set({"last_purchase_value": ...})',
      properties,
    );
    cart.clear();
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('Purchase complete!')));
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: CartState.instance,
      builder: (context, _) {
        final cart = CartState.instance;
        return Scaffold(
          appBar: AppBar(title: const Text('Cart / Checkout')),
          body: cart.items.isEmpty
              ? const Center(
                  child: Text(
                    'Your cart is empty.\nAdd a product from the Catalog tab.',
                    textAlign: TextAlign.center,
                  ),
                )
              : ListView(
                  children: [
                    for (final product in cart.items)
                      ListTile(
                        title: Text(product.name),
                        trailing: Text('\$${product.price.toStringAsFixed(2)}'),
                      ),
                    const Divider(),
                    ListTile(
                      title: const Text(
                        'Total',
                        style: TextStyle(fontWeight: FontWeight.bold),
                      ),
                      trailing: Text(
                        '\$${cart.total.toStringAsFixed(2)}',
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ),
          bottomNavigationBar: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: FilledButton(
                onPressed: cart.items.isEmpty ? null : _completePurchase,
                child: const Text('Complete purchase'),
              ),
            ),
          ),
        );
      },
    );
  }
}
