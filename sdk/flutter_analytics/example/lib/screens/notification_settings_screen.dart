import 'package:flutter/material.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import '../state/event_log.dart';

/// Notification preferences, pushed from Settings
/// (`settings/notifications`).
///
/// SDK calls: `track('notification_toggled')` +
/// `people.set({'notif_<channel>': ...})` per toggle.
class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({super.key});

  @override
  State<NotificationSettingsScreen> createState() =>
      _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState
    extends State<NotificationSettingsScreen> {
  final Map<String, bool> _channels = {
    'promotions': true,
    'order_updates': true,
    'price_drops': false,
  };

  static const _labels = {
    'promotions': 'Promotions',
    'order_updates': 'Order updates',
    'price_drops': 'Price drop alerts',
  };

  void _toggle(String channel, bool enabled) {
    setState(() => _channels[channel] = enabled);
    final properties = {'channel': channel, 'enabled': enabled};
    MyAmpix.instance.track('notification_toggled', properties: properties);
    MyAmpix.instance.people.set({'notif_$channel': enabled});
    EventLog.instance.log(
      'track("notification_toggled") + people.set({"notif_$channel": $enabled})',
      properties,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: ListView(
        children: [
          for (final entry in _channels.entries)
            SwitchListTile(
              title: Text(_labels[entry.key] ?? entry.key),
              value: entry.value,
              onChanged: (enabled) => _toggle(entry.key, enabled),
            ),
        ],
      ),
    );
  }
}
