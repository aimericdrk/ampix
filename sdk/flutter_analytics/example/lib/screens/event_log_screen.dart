import 'package:flutter/material.dart';

import '../state/event_log.dart';

/// Read-only view of every SDK call the demo has made so far, so a human
/// running the app can see what was tracked without a backend.
class EventLogScreen extends StatelessWidget {
  const EventLogScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: EventLog.instance,
      builder: (context, _) {
        final entries = EventLog.instance.entries;
        return Scaffold(
          appBar: AppBar(
            title: const Text('Event Log'),
            actions: [
              IconButton(
                icon: const Icon(Icons.delete_outline),
                tooltip: 'Clear log',
                onPressed: entries.isEmpty ? null : EventLog.instance.clear,
              ),
            ],
          ),
          body: entries.isEmpty
              ? const Center(child: Text('No events tracked yet.'))
              : ListView.builder(
                  itemCount: entries.length,
                  itemBuilder: (context, index) => ListTile(
                    dense: true,
                    title: Text(
                      entries[index],
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 12,
                      ),
                    ),
                  ),
                ),
        );
      },
    );
  }
}
