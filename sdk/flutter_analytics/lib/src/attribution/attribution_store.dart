import 'dart:convert';

import '../storage/key_value_store.dart';

/// The five marketing `utm_*` parameters the ingest contract whitelists
/// (shared-contracts §5/§14). Any other query parameter on a deep link or
/// install-referrer string is ignored.
const List<String> kUtmKeys = <String>[
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
];

/// Extracts the whitelisted [kUtmKeys] from a deep link's query parameters.
///
/// Returns only the params that are present AND non-empty, so a link with no
/// `utm_*` yields an empty map (which callers treat as "no touch"). Never
/// throws: a malformed/odd [uri] simply yields whatever the platform's own
/// query parser could recover (usually nothing).
Map<String, String> utmFromUri(Uri uri) {
  try {
    return _pickUtm(uri.queryParameters);
  } on Object catch (_) {
    return const <String, String>{};
  }
}

/// Extracts the whitelisted [kUtmKeys] from an Android install-referrer
/// string. The Play `InstallReferrerClient` returns a URL-query-encoded
/// string such as `utm_source=google-play&utm_medium=organic&utm_campaign=x`.
/// Never throws: an unparseable referrer yields an empty map.
Map<String, String> utmFromReferrer(String referrer) {
  try {
    return _pickUtm(Uri.splitQueryString(referrer));
  } on Object catch (_) {
    return const <String, String>{};
  }
}

Map<String, String> _pickUtm(Map<String, String> source) => <String, String>{
  for (final key in kUtmKeys)
    if ((source[key] ?? '').isNotEmpty) key: source[key]!,
};

/// Persists marketing-attribution touches in the injected [KeyValueStore]
/// (design §7-style persistence, shared-contracts §4/§5).
///
/// Two touches are kept:
/// - **first touch** — the FIRST `utm_*` set ever seen, written ONCE and
///   never overwritten. Surfaces as `context.first_utm_source` /
///   `context.first_utm_campaign`.
/// - **last touch** — the MOST RECENT `utm_*` set, overwritten on every new
///   touch. Surfaces as `context.utm_source` … `context.utm_term`.
///
/// Both are attached to every event's context by [ContextCollector]. Never
/// throws on read: corrupt persisted JSON degrades to "no touch" rather than
/// failing SDK init (mirrors `SuperPropertiesStore`'s corrupt-data handling).
class AttributionStore {
  AttributionStore(this._store);

  /// Persisted key for the write-once first touch.
  static const String firstTouchKey = 'mam_attribution_first';

  /// Persisted key for the overwrite-on-touch last touch.
  static const String lastTouchKey = 'mam_attribution_last';

  final KeyValueStore _store;
  Map<String, String> _first = <String, String>{};
  Map<String, String> _last = <String, String>{};

  /// Loads persisted touches. Safe to call once during SDK init. A corrupt
  /// value degrades to empty instead of throwing.
  Future<void> load() async {
    _first = await _read(firstTouchKey);
    _last = await _read(lastTouchKey);
  }

  Future<Map<String, String>> _read(String key) async {
    final raw = await _store.getString(key);
    if (raw == null) return <String, String>{};
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map) {
        return <String, String>{
          for (final entry in decoded.entries)
            if (entry.value is String)
              entry.key.toString(): entry.value as String,
        };
      }
    } on Object catch (_) {
      // Corrupt persisted attribution degrades to "no touch".
    }
    return <String, String>{};
  }

  // --- Last touch (overwritten each new touch) --------------------------
  String? get utmSource => _last['utm_source'];
  String? get utmMedium => _last['utm_medium'];
  String? get utmCampaign => _last['utm_campaign'];
  String? get utmContent => _last['utm_content'];
  String? get utmTerm => _last['utm_term'];

  // --- First touch (write-once). Only source + campaign land in context. -
  String? get firstUtmSource => _first['utm_source'];
  String? get firstUtmCampaign => _first['utm_campaign'];

  /// Records a touch from an already-parsed [utm] map (see [utmFromUri] /
  /// [utmFromReferrer]). The last touch is replaced; the first touch is
  /// written only if none exists yet (write-once). Returns `true` when the
  /// touch carried at least one `utm_*` value (a real touch that was
  /// recorded), `false` when [utm] was empty (nothing recorded).
  Future<bool> record(Map<String, String> utm) async {
    if (utm.isEmpty) return false;
    _last = Map<String, String>.from(utm);
    await _store.setString(lastTouchKey, jsonEncode(_last));
    if (_first.isEmpty) {
      _first = Map<String, String>.from(utm);
      await _store.setString(firstTouchKey, jsonEncode(_first));
    }
    return true;
  }
}
