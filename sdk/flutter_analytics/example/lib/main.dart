import 'package:flutter/material.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import 'demo_config.dart';
import 'screens/root_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Never throws: on failure (unreachable backend, rejected token, ...) the
  // SDK stays disabled and every later call becomes a logged no-op. The
  // demo keeps working either way — see lib/demo_config.dart.
  await MyAmpix.init(
    demoToken,
    config: const MyAmpixConfig(
      serverUrl: demoServerUrl,
      debug: true,
      logLevel: MyAmpixLogLevel.debug,
    ),
  );

  // Demonstrates registerSuperProperties: attached to every event tracked
  // for the rest of this process, on top of the per-call properties below.
  MyAmpix.instance.registerSuperProperties({
    'demo_app': true,
    'platform': 'flutter',
  });

  MyAmpix.instance.registerSuperProperties({'country': 'FR'});
  // Reference screenshots are a DEBUG-only developer tool. Uncomment to
  // activate capture (the ONLY switch — there is no config flag): the capture
  // button appears and populates the admin's reference images as you
  // navigate. A release build never captures/uploads (production users never
  // send screenshots). See §14 of HOW-TO-USE.md.
  // MyAmpix.instance.retakeScreenshots();

  runApp(const ShopApp());
}

class ShopApp extends StatelessWidget {
  const ShopApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MyAmpix Shop Demo',
      theme: ThemeData(colorSchemeSeed: Colors.deepPurple, useMaterial3: true),
      // REQUIRED for autocapture: MyAmpixObserver emits `$screen_view` on every
      // navigation — which is ALSO what triggers automatic screenshot capture
      // (§18). Without it, no screen views and no screenshots are ever captured.
      navigatorObservers: [MyAmpixObserver()],
      // MyAmpixTracker autocaptures `$tap` / `$rage_tap` (powers click heatmaps).
      builder: (context, child) =>
          MyAmpixTracker(child: child ?? const SizedBox.shrink()),
      home: const RootScreen(),
    );
  }
}
