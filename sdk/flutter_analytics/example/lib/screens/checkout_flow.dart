import 'package:flutter/material.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import '../state/cart_state.dart';
import '../state/event_log.dart';

/// Multi-step checkout funnel pushed from the cart:
///
///   cart tab > cart/checkout/shipping > cart/checkout/payment >
///   cart/checkout/confirmation
///
/// Three separate routes (not a PageView) so every step is its own
/// `$screen_view` — a realistic funnel to test drop-off analysis against.
///
/// SDK calls across the flow: `track('shipping_method_selected')`,
/// `track('payment_method_selected')`, then on the confirmation screen
/// `track('checkout_completed')` (whose duration was started by
/// `timeEvent` back on the cart) + `people.set({'last_purchase_value'})`.
class ShippingScreen extends StatefulWidget {
  const ShippingScreen({super.key});

  @override
  State<ShippingScreen> createState() => _ShippingScreenState();
}

class _ShippingScreenState extends State<ShippingScreen> {
  String _method = 'standard';

  static const _methods = {
    'standard': 'Standard (3-5 days) — free',
    'express': 'Express (1-2 days) — \$9.90',
    'pickup': 'Store pickup — free',
  };

  void _continue() {
    final properties = {'method': _method};
    MyAmpix.instance.track('shipping_method_selected', properties: properties);
    EventLog.instance.log('track("shipping_method_selected")', properties);
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        settings: const RouteSettings(name: 'cart/checkout/payment'),
        builder: (_) => PaymentScreen(shippingMethod: _method),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Shipping')),
      body: RadioGroup<String>(
        groupValue: _method,
        onChanged: (value) => setState(() => _method = value ?? _method),
        child: ListView(
          children: [
            for (final entry in _methods.entries)
              RadioListTile<String>(
                title: Text(entry.value),
                value: entry.key,
              ),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton(
            onPressed: _continue,
            child: const Text('Continue to payment'),
          ),
        ),
      ),
    );
  }
}

class PaymentScreen extends StatefulWidget {
  const PaymentScreen({super.key, required this.shippingMethod});

  final String shippingMethod;

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  String _method = 'card';

  static const _methods = {
    'card': 'Credit card',
    'paypal': 'PayPal',
    'apple_pay': 'Apple Pay',
  };

  void _pay() {
    final properties = {'method': _method};
    MyAmpix.instance.track('payment_method_selected', properties: properties);
    EventLog.instance.log('track("payment_method_selected")', properties);
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        settings: const RouteSettings(name: 'cart/checkout/confirmation'),
        builder: (_) => ConfirmationScreen(
          shippingMethod: widget.shippingMethod,
          paymentMethod: _method,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Payment')),
      body: RadioGroup<String>(
        groupValue: _method,
        onChanged: (value) => setState(() => _method = value ?? _method),
        child: ListView(
          children: [
            for (final entry in _methods.entries)
              RadioListTile<String>(
                title: Text(entry.value),
                value: entry.key,
              ),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton(onPressed: _pay, child: const Text('Pay now')),
        ),
      ),
    );
  }
}

class ConfirmationScreen extends StatefulWidget {
  const ConfirmationScreen({
    super.key,
    required this.shippingMethod,
    required this.paymentMethod,
  });

  final String shippingMethod;
  final String paymentMethod;

  @override
  State<ConfirmationScreen> createState() => _ConfirmationScreenState();
}

class _ConfirmationScreenState extends State<ConfirmationScreen> {
  late final double _total;
  late final int _items;

  @override
  void initState() {
    super.initState();
    final cart = CartState.instance;
    _total = cart.total;
    _items = cart.itemCount;
    final properties = {
      'value': _total,
      'items': _items,
      'shipping': widget.shippingMethod,
      'payment': widget.paymentMethod,
    };
    // The duration since timeEvent('checkout_completed') fired on the cart
    // auto-attaches here — the whole funnel is measured, not just this screen.
    MyAmpix.instance.track('checkout_completed', properties: properties);
    MyAmpix.instance.people.set({'last_purchase_value': _total});
    EventLog.instance.log(
      'track("checkout_completed") + people.set({"last_purchase_value": ...})',
      properties,
    );
    cart.clear();
  }

  void _backToShop() {
    Navigator.of(context).popUntil((route) => route.isFirst);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Order confirmed'),
        automaticallyImplyLeading: false,
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.check_circle, color: Colors.green, size: 72),
            const SizedBox(height: 16),
            Text(
              'Thanks for your purchase!',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 8),
            Text('$_items item(s) — \$${_total.toStringAsFixed(2)}'),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton(
            onPressed: _backToShop,
            child: const Text('Back to shop'),
          ),
        ),
      ),
    );
  }
}
