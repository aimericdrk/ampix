import '../storage/key_value_store.dart';

/// The stable per-install device identifier stamped on every event's
/// `context.device_id`.
///
/// Resolution happens once, on the first [resolve] call, and is then frozen:
/// whatever id was persisted first keeps being reported for the life of the
/// install. That matters because the OS-supplied id is not actually immutable
/// — iOS rotates `identifierForVendor` once every app from the same vendor is
/// uninstalled — and a device that silently changed identity mid-history would
/// read as two devices.
///
/// The OS id is preferred when there is one ([resolve]'s `platformId`, i.e.
/// iOS `identifierForVendor`). Android exposes no equivalent that is stable
/// AND permission-free — `device_info_plus` deliberately dropped `androidId`
/// — so there the SDK mints a UUID itself. Either way this is an
/// install-scoped id, never a hardware serial or an advertising id.
class DeviceIdStore {
  DeviceIdStore({
    required KeyValueStore store,
    required String Function() idFactory,
  }) : _store = store,
       _idFactory = idFactory;

  static const storageKey = 'mam_device_id';

  final KeyValueStore _store;
  final String Function() _idFactory;
  String? _value;

  /// The resolved id, or null before the first [resolve] (or after one that
  /// failed).
  String? get value => _value;

  /// Returns the device id, resolving and persisting it on the first call:
  /// the already-persisted value if there is one, else [platformId] when the
  /// OS supplied a usable one, else a freshly minted UUID.
  ///
  /// Never throws: a failing store degrades to a null device id (the field is
  /// simply omitted from the context) rather than into the host app.
  Future<String?> resolve(String? platformId) async {
    final cached = _value;
    if (cached != null) return cached;
    try {
      final persisted = await _store.getString(storageKey);
      if (persisted != null && persisted.isNotEmpty) return _value = persisted;
      final fromPlatform = platformId?.trim() ?? '';
      final resolved = fromPlatform.isNotEmpty ? fromPlatform : _idFactory();
      await _store.setString(storageKey, resolved);
      return _value = resolved;
    } on Object catch (_) {
      // Deliberately swallowed: the SDK never throws into the host app.
      return null;
    }
  }
}
