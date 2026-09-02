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
        'IdentityManager.load() must complete before identify()/reset()',
      );
    }
    if (userId == _distinctId) return false;
    _distinctId = userId;
    await _store.setString(distinctIdKey, userId);
    return true;
  }

  /// Logout: fresh anonymous identity (design §3). Returns true when a new
  /// anonymous identity was actually issued.
  ///
  /// **A no-op when nobody is identified.** Minting a new anonymous id only
  /// means something if there is an identity to walk away from: when
  /// `distinct_id` is already the anonymous id, the old id and the new one
  /// are equally anonymous, so the swap protects nothing and instead splits
  /// one device across two identities. Every event between the two resets
  /// then belongs to an anon id that no `$identify` will ever name, so
  /// `identity_mappings` can never stitch it — it is stranded in the
  /// dashboard as a permanent "Unknown user" holding whatever few events
  /// trailed the logout. Hosts hit this routinely: a delete-account flow
  /// that resets and then signs out resets twice, and a reset on a launch
  /// where the user never signed in resets from anonymous to anonymous.
  ///
  /// Skipping it also keeps the pre-sign-in events attached: they stay on
  /// the anonymous id that the eventual [identify] names, which is exactly
  /// the anon→canonical stitch the contract is built on.
  Future<bool> reset() async {
    if (!_loaded) {
      throw StateError(
        'IdentityManager.load() must complete before identify()/reset()',
      );
    }
    if (_distinctId == _anonId) return false;
    _anonId = _idFactory();
    _distinctId = _anonId;
    await _store.setString(anonIdKey, _anonId);
    await _store.remove(distinctIdKey);
    return true;
  }
}
