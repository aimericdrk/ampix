import '../storage/key_value_store.dart';

/// Persists the RevenueCat app_user_id the host app declared via
/// [MyAmpix.setRevenueCatAppUserId], so `$rc_link` can be re-emitted
/// after identity changes and cleared on reset.
class RcLinkStore {
  RcLinkStore({required KeyValueStore store}) : _store = store;

  static const storageKey = 'mam_rc_app_user_id';

  final KeyValueStore _store;
  String? _value;

  String? get value => _value;

  Future<void> load() async {
    _value = await _store.getString(storageKey);
  }

  Future<void> set(String id) async {
    _value = id;
    await _store.setString(storageKey, id);
  }

  Future<void> clear() async {
    _value = null;
    await _store.remove(storageKey);
  }
}
