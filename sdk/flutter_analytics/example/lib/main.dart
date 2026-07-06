import 'package:flutter/material.dart';
import 'package:myampmix_analytics/myampmix_analytics.dart';

import 'demo_config.dart';
import 'screens/root_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Never throws: on failure (unreachable backend, rejected token, ...) the
  // SDK stays disabled and every later call becomes a logged no-op. The
  // demo keeps working either way — see lib/demo_config.dart.
  await MyAmpMix.init(
    demoToken,
    config: const MyAmpMixConfig(
      serverUrl: demoServerUrl,
      debug: true,
      logLevel: MyAmpMixLogLevel.debug,
      // Reference screenshots are a DEBUG-only developer tool: this demo runs
      // in debug, so enabling it populates the admin's reference images as you
      // navigate. A release build never captures/uploads (production users
      // never send screenshots). See §14 of HOW-TO-USE.md.
      autocaptureScreenshots: true,
    ),
  );

  // Demonstrates registerSuperProperties: attached to every event tracked
  // for the rest of this process, on top of the per-call properties below.
  MyAmpMix.instance.registerSuperProperties({
    'demo_app': true,
    'platform': 'flutter',
  });

  runApp(const ShopApp());
}

class ShopApp extends StatelessWidget {
  const ShopApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MyAmpMix Shop Demo',
      theme: ThemeData(colorSchemeSeed: Colors.deepPurple, useMaterial3: true),
      // REQUIRED for autocapture: MyAmpMixObserver emits `$screen_view` on every
      // navigation — which is ALSO what triggers automatic screenshot capture
      // (§18). Without it, no screen views and no screenshots are ever captured.
      navigatorObservers: [MyAmpMixObserver()],
      // MyAmpMixTracker autocaptures `$tap` / `$rage_tap` (powers click heatmaps).
      builder: (context, child) => MyAmpMixTracker(child: child ?? const SizedBox.shrink()),
      home: const RootScreen(),
    );
  }
}
