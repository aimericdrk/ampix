import 'package:flutter/material.dart';
import 'package:myampmix_analytics/myampmix_analytics.dart';

import '../state/event_log.dart';

/// Settings screen.
///
/// SDK calls: `optOutTracking()` / `optInTracking()` wired to the toggle;
/// `flush()` on "Flush now".
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _optedOut = false;

  void _toggleOptOut(bool optedOut) {
    setState(() => _optedOut = optedOut);
    if (optedOut) {
      MyAmpMix.instance.optOutTracking();
      EventLog.instance.log('optOutTracking()');
    } else {
      MyAmpMix.instance.optInTracking();
      EventLog.instance.log('optInTracking()');
    }
  }

  void _flushNow() {
    MyAmpMix.instance.flush();
    EventLog.instance.log('flush()');
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('Flush requested')));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          SwitchListTile(
            title: const Text('Opt out of tracking'),
            subtitle: const Text(
              'When on, all further track()/people.* calls are dropped.',
            ),
            value: _optedOut,
            onChanged: _toggleOptOut,
          ),
          const Divider(),
          ListTile(
            title: const Text('Flush now'),
            subtitle: const Text('Force an immediate upload of queued events.'),
            trailing: const Icon(Icons.cloud_upload_outlined),
            onTap: _flushNow,
          ),
        ],
      ),
    );
  }
}
