import '../storage/event_store.dart';
import '../storage/key_value_store.dart';
import '../storage/profile_op_store.dart';

/// Persisted opt-out (design §9): opting out purges both queues, and the
/// pipeline/People drop everything while `isOptedOut` is true.
class OptOutState {
  OptOutState({
    required KeyValueStore store,
    required EventStore events,
    required ProfileOpStore profiles,
  }) : _store = store,
       _events = events,
       _profiles = profiles;

  static const storageKey = 'mam_opted_out';

  final KeyValueStore _store;
  final EventStore _events;
  final ProfileOpStore _profiles;

  bool _optedOut = false;

  bool get isOptedOut => _optedOut;

  Future<void> load() async {
    _optedOut = await _store.getString(storageKey) == '1';
  }

  Future<void> optOut() async {
    _optedOut = true;
    await _store.setString(storageKey, '1');
    await _events.clear();
    await _profiles.clear();
  }

  Future<void> optIn() async {
    _optedOut = false;
    await _store.setString(storageKey, '0');
  }
}
