import 'package:shared_preferences/shared_preferences.dart';

/// Small persisted string map for identity, session, super properties and
/// opt-out state. Abstracted so tests use an in-memory fake.
abstract interface class KeyValueStore {
  Future<String?> getString(String key);
  Future<void> setString(String key, String value);
  Future<void> remove(String key);
}

class SharedPrefsKeyValueStore implements KeyValueStore {
  SharedPrefsKeyValueStore(this._prefs);

  final SharedPreferences _prefs;

  static Future<SharedPrefsKeyValueStore> open() async =>
      SharedPrefsKeyValueStore(await SharedPreferences.getInstance());

  @override
  Future<String?> getString(String key) async => _prefs.getString(key);

  @override
  Future<void> setString(String key, String value) => _prefs.setString(key, value);

  @override
  Future<void> remove(String key) => _prefs.remove(key);
}
