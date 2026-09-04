import '../storage/key_value_store.dart';

/// One host-declared context string, persisted across launches and stamped on
/// every event: the push token (`context.device_token`) and the host's own
/// free-form identifier (`context.unique_id`) are each an instance of this.
///
/// Persisted rather than kept in memory because these values arrive late and
/// asynchronously — a messaging SDK hands the token over some way into the
/// launch, a device identifier comes off a platform channel — so without a
/// stored copy every event before that point would ship without one. Each
/// declaration overwrites the last, which is what makes rotation (a refreshed
/// push token, a re-read identifier) land correctly.
class HostContextValueStore {
  HostContextValueStore({required KeyValueStore store, required this.storageKey})
    : _store = store;

  /// Storage key for the push notification token declared via
  /// `MyAmpix.setDeviceToken`.
  static const deviceTokenKey = 'mam_device_token';

  /// Storage key for the free-form identifier declared via
  /// `MyAmpix.setUniqueId`.
  static const uniqueIdKey = 'mam_unique_id';

  final String storageKey;
  final KeyValueStore _store;
  String? _value;

  String? get value => _value;

  Future<void> load() async {
    _value = await _store.getString(storageKey);
  }

  Future<void> set(String value) async {
    _value = value;
    await _store.setString(storageKey, value);
  }

  Future<void> clear() async {
    _value = null;
    await _store.remove(storageKey);
  }
}
