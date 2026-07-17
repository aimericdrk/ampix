import 'package:flutter/material.dart';
import 'package:myampix_purchases/myampix_purchases.dart';

/// Minimal end-to-end demo of the MyAmpixPurchases facade:
/// `getOfferings` -> `purchasePackage` -> `getCustomerInfo` (entitlements.active)
/// -> `restorePurchases`.
class PurchasesDemoPage extends StatefulWidget {
  const PurchasesDemoPage({super.key});

  @override
  State<PurchasesDemoPage> createState() => _PurchasesDemoPageState();
}

class _PurchasesDemoPageState extends State<PurchasesDemoPage> {
  Offerings? _offerings;
  CustomerInfo? _customerInfo;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    // Fires on every CustomerInfo change (purchase, restore, renewal).
    MyAmpixPurchases.addCustomerInfoUpdateListener(_onCustomerInfo);
    _load();
  }

  @override
  void dispose() {
    MyAmpixPurchases.removeCustomerInfoUpdateListener(_onCustomerInfo);
    super.dispose();
  }

  void _onCustomerInfo(CustomerInfo info) {
    if (!mounted) return;
    setState(() => _customerInfo = info);
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final offerings = await MyAmpixPurchases.getOfferings();
      final info = await MyAmpixPurchases.getCustomerInfo();
      if (!mounted) return;
      setState(() {
        _offerings = offerings;
        _customerInfo = info;
        _loading = false;
      });
    } on PurchasesError catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    }
  }

  Future<void> _buy(Package package) async {
    try {
      final result = await MyAmpixPurchases.purchasePackage(package);
      if (!mounted) return;
      setState(() => _customerInfo = result.customerInfo);
      _snack('Purchased ${package.identifier}');
    } on PurchasesError catch (e) {
      _snack(
        e.userCancelled ? 'Purchase cancelled' : 'Purchase failed: ${e.message}',
      );
    }
  }

  Future<void> _restore() async {
    try {
      final info = await MyAmpixPurchases.restorePurchases();
      if (!mounted) return;
      setState(() => _customerInfo = info);
      _snack('Restored ${info.entitlements.active.length} entitlement(s)');
    } on PurchasesError catch (e) {
      _snack('Restore failed: ${e.message}');
    }
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('MyAmpix Purchases Demo'),
        actions: [
          IconButton(
            onPressed: _restore,
            icon: const Icon(Icons.restore),
            tooltip: 'Restore purchases',
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return _ErrorView(message: _error!, onRetry: _load);
    }
    final packages = _offerings?.current?.availablePackages ?? const <Package>[];
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Entitlements', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        _EntitlementsView(customerInfo: _customerInfo),
        const Divider(height: 32),
        Text('Packages', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        if (packages.isEmpty)
          const Text('No packages in the current offering.')
        else
          ...packages.map(
            (p) => Card(
              child: ListTile(
                title: Text(
                  p.storeProduct.title.isEmpty ? p.identifier : p.storeProduct.title,
                ),
                subtitle: Text(p.storeProduct.priceString),
                trailing: FilledButton(
                  onPressed: () => _buy(p),
                  child: const Text('Buy'),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _EntitlementsView extends StatelessWidget {
  const _EntitlementsView({required this.customerInfo});

  final CustomerInfo? customerInfo;

  @override
  Widget build(BuildContext context) {
    final active = customerInfo?.entitlements.active ?? const <String, EntitlementInfo>{};
    if (active.isEmpty) {
      return const Text('No active entitlements.');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final e in active.values)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Row(
              children: [
                const Icon(Icons.check_circle, color: Colors.green, size: 18),
                const SizedBox(width: 8),
                Expanded(child: Text('${e.identifier} · ${e.productIdentifier}')),
              ],
            ),
          ),
      ],
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Text(message, textAlign: TextAlign.center),
          ),
          const SizedBox(height: 12),
          FilledButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}
