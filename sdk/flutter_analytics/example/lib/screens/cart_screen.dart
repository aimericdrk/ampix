import 'package:flutter/material.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import '../state/cart_state.dart';
import '../state/event_log.dart';
import 'checkout_flow.dart';

/// Cart screen — the entry of the multi-step checkout funnel
/// (cart > shipping > payment > confirmation).
///
/// SDK calls: `timeEvent('checkout_completed')` on entering the screen (the
/// timed duration auto-attaches when the confirmation screen finally tracks
/// `checkout_completed`, so it measures the WHOLE funnel);
/// `track('checkout_started')` on "Checkout".
class CartScreen extends StatefulWidget {
  const CartScreen({super.key});

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  @override
  void initState() {
    super.initState();
    MyAmpix.instance.timeEvent('checkout_completed');
    EventLog.instance.log('timeEvent("checkout_completed")');
  }

  void _startCheckout() {
    final cart = CartState.instance;
    final properties = {'value': cart.total, 'items': cart.itemCount};
    MyAmpix.instance.track('checkout_started', properties: properties);
    EventLog.instance.log('track("checkout_started")', properties);
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        settings: const RouteSettings(name: 'cart/checkout/shipping'),
        builder: (_) => const ShippingScreen(),
      ),
    );
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
                onPressed: cart.items.isEmpty ? null : _startCheckout,
                child: const Text('Checkout'),
              ),
            ),
          ),
        );
      },
    );
  }
}
