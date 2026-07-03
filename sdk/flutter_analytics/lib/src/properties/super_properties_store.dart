import 'dart:convert';

import '../storage/key_value_store.dart';

/// Persisted properties merged into every tracked event (design §7).
class SuperPropertiesStore {
  SuperPropertiesStore(this._store);

  static const storageKey = 'mam_super_properties';

  final KeyValueStore _store;
  Map<String, Object?> _properties = <String, Object?>{};

  Future<void> load() async {
    final raw = await _store.getString(storageKey);
    if (raw != null) {
      _properties = Map<String, Object?>.from(
        jsonDecode(raw) as Map<String, dynamic>,
      );
    }
  }

  Map<String, Object?> get current => Map.unmodifiable(_properties);

  Future<void> register(Map<String, Object?> properties) async {
    _properties = {..._properties, ...properties};
    await _store.setString(storageKey, jsonEncode(_properties));
  }

  Future<void> clear() async {
    _properties = <String, Object?>{};
    await _store.remove(storageKey);
  }
}
