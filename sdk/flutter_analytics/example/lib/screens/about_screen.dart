import 'package:flutter/material.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import '../state/event_log.dart';

/// About screen, pushed from Settings (`settings/about`).
///
/// SDK calls: `track('support_contacted')` on "Contact support".
class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  void _contactSupport(BuildContext context) {
    const properties = {'channel': 'email'};
    MyAmpix.instance.track('support_contacted', properties: properties);
    EventLog.instance.log('track("support_contacted")', properties);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Support email opened (demo)')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('About')),
      body: ListView(
        children: [
          const ListTile(
            title: Text('MyAmpix Shop Demo'),
            subtitle: Text('Exercises the myampix_analytics SDK end to end.'),
          ),
          const ListTile(title: Text('Version'), trailing: Text('1.0.0')),
          const Divider(),
          ListTile(
            title: const Text('Contact support'),
            trailing: const Icon(Icons.mail_outline),
            onTap: () => _contactSupport(context),
          ),
        ],
      ),
    );
  }
}
