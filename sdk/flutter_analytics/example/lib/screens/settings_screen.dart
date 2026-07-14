import 'package:flutter/material.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import '../state/event_log.dart';
import 'about_screen.dart';
import 'notification_settings_screen.dart';
import 'onboarding_flow.dart';

/// Settings screen. Also hosts entry points into the nested Notifications
/// and About pages, and lets you replay the onboarding flow.
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
      MyAmpix.instance.optOutTracking();
      EventLog.instance.log('optOutTracking()');
    } else {
      MyAmpix.instance.optInTracking();
      EventLog.instance.log('optInTracking()');
    }
  }

  void _flushNow() {
    MyAmpix.instance.flush();
    EventLog.instance.log('flush()');
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('Flush requested')));
  }

  void _openNotifications() {
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        settings: const RouteSettings(name: 'settings/notifications'),
        builder: (_) => const NotificationSettingsScreen(),
      ),
    );
  }

  void _openAbout() {
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        settings: const RouteSettings(name: 'settings/about'),
        builder: (_) => const AboutScreen(),
      ),
    );
  }

  void _replayOnboarding() {
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        settings: const RouteSettings(name: 'onboarding/welcome'),
        builder: (_) => const OnboardingWelcomeScreen(),
      ),
    );
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
          const Divider(),
          ListTile(
            title: const Text('Notifications'),
            subtitle: const Text('Per-channel toggles (nested page).'),
            trailing: const Icon(Icons.chevron_right),
            onTap: _openNotifications,
          ),
          ListTile(
            title: const Text('About'),
            subtitle: const Text('App info + contact support (nested page).'),
            trailing: const Icon(Icons.chevron_right),
            onTap: _openAbout,
          ),
          const Divider(),
          ListTile(
            title: const Text('Replay onboarding'),
            subtitle: const Text('3-step flow: welcome > preferences > done.'),
            trailing: const Icon(Icons.replay),
            onTap: _replayOnboarding,
          ),
        ],
      ),
    );
  }
}
