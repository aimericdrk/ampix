import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

/// Small persisted string map, abstracted so tests use an in-memory fake.
/// (Purchases mirrors `myampix_analytics`'s `KeyValueStore`; its only consumer
/// here is [AppUserIdStore], so it is co-located rather than in a storage/ dir.)
abstract interface class KeyValueStore {
  Future<String?> getString(String key);
  Future<void> setString(String key, String value);
  Future<void> remove(String key);
}

/// `shared_preferences`-backed [KeyValueStore] for production.
class SharedPrefsKeyValueStore implements KeyValueStore {
  SharedPrefsKeyValueStore(this._prefs);

  final SharedPreferences _prefs;

  static Future<SharedPrefsKeyValueStore> open() async =>
      SharedPrefsKeyValueStore(await SharedPreferences.getInstance());

  @override
  Future<String?> getString(String key) async => _prefs.getString(key);

  @override
  Future<void> setString(String key, String value) =>
      _prefs.setString(key, value);

  @override
  Future<void> remove(String key) => _prefs.remove(key);
}

/// Owns the RevenueCat app-user-id (design §4). An anonymous
/// `$RCAnonymousID:<hex>` id is minted + persisted on first use; `logIn`
/// switches to a custom id ([setId]); `logOut` mints a fresh anonymous id
/// ([reset]). All reads/writes go through the injected [KeyValueStore] so the
/// identity transitions are testable with no `shared_preferences` plugin.
class AppUserIdStore {
  AppUserIdStore({required KeyValueStore store, String Function()? uuidFactory})
      : _store = store,
        _uuidFactory = uuidFactory ?? (() => const Uuid().v4());

  /// Persisted-map key for the active app-user-id.
  static const storageKey = 'mp_app_user_id';

  /// RevenueCat's anonymous-id sentinel prefix.
  static const anonymousPrefix = r'$RCAnonymousID:';

  final KeyValueStore _store;
  final String Function() _uuidFactory;

  String? _current;
  Future<String>? _pending;

  /// Whether [id] is an anonymous (`$RCAnonymousID:`) id.
  static bool isAnonymousId(String id) => id.startsWith(anonymousPrefix);

  /// Whether the last-resolved id is anonymous. Reports `true` before the first
  /// [currentId] (the pre-login anonymous default).
  bool get isAnonymous => isAnonymousId(_current ?? anonymousPrefix);

  /// The active app-user-id, loading the persisted value or minting +
  /// persisting a fresh anonymous id on first launch.
  ///
  /// Concurrent callers before resolution completes share a single in-flight
  /// future ([_pending]), so exactly one mint + persist happens even when
  /// [currentId] is called concurrently (no split identity).
  Future<String> currentId() async {
    final current = _current;
    if (current != null) return current;
    return _pending ??= _resolveCurrentId();
  }

  Future<String> _resolveCurrentId() async {
    try {
      final existing = await _store.getString(storageKey);
      final id = existing ?? await _persist(_mintAnonymous());
      _current = id;
      return id;
    } finally {
      _pending = null;
    }
  }

  /// `logIn`: switch to a caller-supplied id and persist it.
  Future<void> setId(String appUserId) async {
    await _persist(appUserId);
  }

  /// `logOut`: mint + persist a fresh anonymous id, returning it.
  Future<String> reset() async => _persist(_mintAnonymous());

  Future<String> _persist(String id) async {
    _current = id;
    await _store.setString(storageKey, id);
    return id;
  }

  String _mintAnonymous() =>
      '$anonymousPrefix${_uuidFactory().replaceAll('-', '')}';
}
