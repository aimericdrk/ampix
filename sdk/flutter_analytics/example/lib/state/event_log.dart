import 'package:flutter/foundation.dart';

/// A tiny in-app log of every analytics call the demo makes, so a human
/// running the app can SEE what was tracked without needing a backend or a
/// network inspector.
///
/// This is entirely app-side bookkeeping, kept separate from whatever the
/// SDK itself does with each call (queue it locally, upload it, drop it
/// while opted out, etc).
class EventLog extends ChangeNotifier {
  EventLog._();

  /// Shared singleton so every screen appends to the same log.
  static final EventLog instance = EventLog._();

  final List<String> _entries = [];

  /// Most recent entry first.
  List<String> get entries => List.unmodifiable(_entries);

  void log(String action, [Map<String, Object?>? properties]) {
    final now = DateTime.now();
    String two(int n) => n.toString().padLeft(2, '0');
    final timestamp = '${two(now.hour)}:${two(now.minute)}:${two(now.second)}';
    final suffix = (properties == null || properties.isEmpty)
        ? ''
        : ' $properties';
    _entries.insert(0, '[$timestamp] $action$suffix');
    notifyListeners();
  }

  void clear() {
    _entries.clear();
    notifyListeners();
  }
}
