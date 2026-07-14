import 'package:flutter/material.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import '../models/product.dart';
import '../state/event_log.dart';

/// Replayable onboarding flow, launched from Settings:
///
///   onboarding/welcome > onboarding/preferences > onboarding/done
///
/// Each step is its own pushed route so the dashboard can chart step-by-step
/// completion.
///
/// SDK calls: `track('onboarding_started')`, `track('onboarding_skipped')`,
/// `track('onboarding_step_completed')` per step,
/// `people.set({'favorite_categories': ...})` on the preferences step, and
/// `track('onboarding_completed')` (timed from the welcome screen).
class OnboardingWelcomeScreen extends StatefulWidget {
  const OnboardingWelcomeScreen({super.key});

  @override
  State<OnboardingWelcomeScreen> createState() =>
      _OnboardingWelcomeScreenState();
}

class _OnboardingWelcomeScreenState extends State<OnboardingWelcomeScreen> {
  @override
  void initState() {
    super.initState();
    MyAmpix.instance.track('onboarding_started');
    MyAmpix.instance.timeEvent('onboarding_completed');
    EventLog.instance.log(
      'track("onboarding_started") + timeEvent("onboarding_completed")',
    );
  }

  void _next() {
    const properties = {'step': 'welcome'};
    MyAmpix.instance.track('onboarding_step_completed', properties: properties);
    EventLog.instance.log('track("onboarding_step_completed")', properties);
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        settings: const RouteSettings(name: 'onboarding/preferences'),
        builder: (_) => const OnboardingPreferencesScreen(),
      ),
    );
  }

  void _skip() {
    const properties = {'step': 'welcome'};
    MyAmpix.instance.track('onboarding_skipped', properties: properties);
    EventLog.instance.log('track("onboarding_skipped")', properties);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Welcome'),
        actions: [TextButton(onPressed: _skip, child: const Text('Skip'))],
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.waving_hand, size: 72, color: Colors.amber),
            const SizedBox(height: 16),
            Text(
              'Welcome to the shop!',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 8),
            const Text('A quick tour to personalize your experience.'),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton(
            onPressed: _next,
            child: const Text('Get started'),
          ),
        ),
      ),
    );
  }
}

class OnboardingPreferencesScreen extends StatefulWidget {
  const OnboardingPreferencesScreen({super.key});

  @override
  State<OnboardingPreferencesScreen> createState() =>
      _OnboardingPreferencesScreenState();
}

class _OnboardingPreferencesScreenState
    extends State<OnboardingPreferencesScreen> {
  final Set<String> _selected = {};

  void _next() {
    final favorites = _selected.toList()..sort();
    final properties = {'step': 'preferences', 'favorites': favorites};
    MyAmpix.instance.track('onboarding_step_completed', properties: properties);
    MyAmpix.instance.people.set({'favorite_categories': favorites});
    EventLog.instance.log(
      'track("onboarding_step_completed") + people.set({"favorite_categories": ...})',
      properties,
    );
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        settings: const RouteSettings(name: 'onboarding/done'),
        builder: (_) => const OnboardingDoneScreen(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Your interests')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Pick the categories you care about:'),
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              children: [
                for (final category in demoCategories())
                  FilterChip(
                    label: Text(category),
                    selected: _selected.contains(category),
                    onSelected: (selected) => setState(() {
                      selected
                          ? _selected.add(category)
                          : _selected.remove(category);
                    }),
                  ),
              ],
            ),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton(
            onPressed: _selected.isEmpty ? null : _next,
            child: const Text('Continue'),
          ),
        ),
      ),
    );
  }
}

class OnboardingDoneScreen extends StatefulWidget {
  const OnboardingDoneScreen({super.key});

  @override
  State<OnboardingDoneScreen> createState() => _OnboardingDoneScreenState();
}

class _OnboardingDoneScreenState extends State<OnboardingDoneScreen> {
  @override
  void initState() {
    super.initState();
    // Duration since timeEvent('onboarding_completed') on the welcome screen
    // auto-attaches: total time spent onboarding.
    MyAmpix.instance.track('onboarding_completed');
    EventLog.instance.log('track("onboarding_completed")');
  }

  void _finish() {
    Navigator.of(context).popUntil((route) => route.isFirst);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('All set'),
        automaticallyImplyLeading: false,
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.rocket_launch, size: 72, color: Colors.deepPurple),
            const SizedBox(height: 16),
            Text(
              'You are all set!',
              style: Theme.of(context).textTheme.titleLarge,
            ),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton(
            onPressed: _finish,
            child: const Text('Start shopping'),
          ),
        ),
      ),
    );
  }
}
