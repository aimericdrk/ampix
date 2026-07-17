import 'package:myampix_purchases/src/identity/app_user_id_store.dart';

/// In-memory [KeyValueStore] fake (no `shared_preferences` plugin), mirroring
/// `myampix_analytics`'s test helper of the same name.
class InMemoryKeyValueStore implements KeyValueStore {
  final Map<String, String> values = {};

  /// Number of [setString] calls, so tests can assert a value was written
  /// exactly once (e.g. no double-mint under concurrent callers).
  int writeCount = 0;

  @override
  Future<String?> getString(String key) async => values[key];

  @override
  Future<void> setString(String key, String value) async {
    writeCount++;
    values[key] = value;
  }

  @override
  Future<void> remove(String key) async => values.remove(key);
}
