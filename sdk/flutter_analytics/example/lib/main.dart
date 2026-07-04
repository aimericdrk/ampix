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
    config: const MyAmpMixConfig(serverUrl: demoServerUrl, debug: true),
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
      home: const RootScreen(),
    );
  }
}
