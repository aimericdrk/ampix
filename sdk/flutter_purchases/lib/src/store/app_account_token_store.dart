import 'package:uuid/uuid.dart';

import '../identity/app_user_id_store.dart' show KeyValueStore;

/// Derives a stable UUID `appAccountToken` for a given app-user-id (design
/// §4). StoreKit 2's `appAccountToken` must be a UUID, and the server binds
/// token↔customer, so the SAME app-user-id must always resolve to the SAME
/// token across purchases: if [tokenFor]'s input is already a valid UUID it
/// is returned as-is; otherwise a UUID is minted once via [uuidFactory] and
/// persisted (keyed by the app-user-id) in the injected [KeyValueStore], so
/// every later purchase for that user reuses it.
class AppAccountTokenStore {
  AppAccountTokenStore({
    required KeyValueStore store,
    String Function()? uuidFactory,
  })  : _store = store,
        _uuidFactory = uuidFactory ?? (() => const Uuid().v4());

  static const _keyPrefix = 'mp_app_account_token:';

  static final RegExp _uuidPattern = RegExp(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  );

  final KeyValueStore _store;
  final String Function() _uuidFactory;

  /// The stable UUID `appAccountToken` for [appUserId]. Mints + persists one
  /// on first use for a non-UUID id; reuses the persisted value thereafter.
  Future<String> tokenFor(String appUserId) async {
    if (_uuidPattern.hasMatch(appUserId)) return appUserId;

    final key = '$_keyPrefix$appUserId';
    final existing = await _store.getString(key);
    if (existing != null && existing.isNotEmpty) return existing;

    final minted = _uuidFactory();
    await _store.setString(key, minted);
    return minted;
  }
}
