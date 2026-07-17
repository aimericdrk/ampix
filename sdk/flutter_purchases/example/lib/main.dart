import 'package:flutter/material.dart';
import 'package:myampix_purchases/myampix_purchases.dart';

import 'demo_config.dart';
import 'purchases_demo_page.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await configureDemo();
  runApp(const PurchasesDemoApp());
}

/// Configures MyAmpixPurchases for the demo.
///
/// Factored out of [main] so it can be reused; the widget test configures the
/// SDK itself (with `SdkOverrides` fakes) and does NOT call this — production
/// code must never pass the `@visibleForTesting` overrides seam. `configure`
/// never throws internal machinery into the host; on an unreachable backend
/// the throwing read/purchase methods surface a typed `PurchasesError` that
/// the demo page catches and shows on screen.
///
/// NOTE: because `configure`'s only way to wire a native `StoreChannel` is
/// the `@visibleForTesting SdkOverrides.storeChannel` parameter, production
/// code (this function included) currently has no public way to supply one.
/// That means `getOfferings`/`purchasePackage`/`restorePurchases` always
/// surface `PurchasesErrorCode.storeProblemError` when run for real — the
/// demo still never crashes (see [PurchasesDemoPage]), but a real purchase
/// cannot complete until the SDK adds a production path to a `StoreChannel`
/// (tracked in the SDK's own `configure` doc comment). See the README.
Future<void> configureDemo() {
  return MyAmpixPurchases.configure(
    PurchasesConfiguration(
      apiKey: demoApiKey,
      serverUrl: demoServerUrl,
      logLevel: MyAmpixLogLevel.debug,
    ),
  );
}

class PurchasesDemoApp extends StatelessWidget {
  const PurchasesDemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MyAmpix Purchases Demo',
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      home: const PurchasesDemoPage(),
    );
  }
}
