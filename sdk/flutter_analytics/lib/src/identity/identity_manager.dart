import 'package:uuid/uuid.dart';

import '../storage/key_value_store.dart';

/// Owns `anon_id` and `distinct_id` as defined by the ingest contract §4 and
/// design §3: anon_id is a stable per-install UUID v7; distinct_id starts
/// equal to it and switches on identify().
///
/// [load] must complete before [identify] or [reset] is called; both throw a
/// [StateError] otherwise. The SDK facade guarantees this ordering, so the
/// host app never observes the error — it exists to make internal misuse
/// loud in tests instead of surfacing as a LateInitializationError.
class IdentityManager {
  IdentityManager({required KeyValueStore store, String Function()? idFactory})
      : _store = store,
        _idFactory = idFactory ?? (() => const Uuid().v7());

  static const anonIdKey = 'mam_anon_id';
  static const distinctIdKey = 'mam_distinct_id';

  final KeyValueStore _store;
  final String Function() _idFactory;

  late String _anonId;
  late String _distinctId;
  bool _loaded = false;

  String get anonId => _anonId;
  String get distinctId => _distinctId;

  /// Loads persisted identity, generating a first-launch anonymous id.
  Future<void> load() async {
    final storedAnon = await _store.getString(anonIdKey);
    if (storedAnon == null) {
      _anonId = _idFactory();
      await _store.setString(anonIdKey, _anonId);
    } else {
      _anonId = storedAnon;
    }
    _distinctId = await _store.getString(distinctIdKey) ?? _anonId;
    _loaded = true;
  }

  /// Returns true when the distinct id actually changed. The in-memory id is
  /// updated synchronously so immediately following events use it.
  Future<bool> identify(String userId) async {
    if (!_loaded) {
      throw StateError(
          'IdentityManager.load() must complete before identify()/reset()');
    }
    if (userId == _distinctId) return false;
    _distinctId = userId;
    await _store.setString(distinctIdKey, userId);
    return true;
  }

  /// Logout: fresh anonymous identity (design §3).
  Future<void> reset() async {
    if (!_loaded) {
      throw StateError(
          'IdentityManager.load() must complete before identify()/reset()');
    }
    _anonId = _idFactory();
    _distinctId = _anonId;
    await _store.setString(anonIdKey, _anonId);
    await _store.remove(distinctIdKey);
  }
}
