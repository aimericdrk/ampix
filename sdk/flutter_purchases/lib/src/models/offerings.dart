import 'offering.dart';

/// The `GET /v1/offerings` result (spec §3). The server returns only the single
/// `current` offering; `all` is derived as `{ current.identifier: current }`
/// (one entry) — multi-offering support is a flagged server enhancement.
class Offerings {
  const Offerings({required this.all, required this.current});

  /// Takes the endpoint envelope `{ current: ResolvedOffering | null }`.
  factory Offerings.fromJson(Map<String, dynamic> json) {
    final currentJson = json['current'] as Map<String, dynamic>?;
    final current =
        currentJson == null ? null : Offering.fromJson(currentJson);
    return Offerings(
      all: current == null
          ? const <String, Offering>{}
          : {current.identifier: current},
      current: current,
    );
  }

  final Map<String, Offering> all;
  final Offering? current;

  Map<String, Object?> toJson() => {
        'all': all.map((k, v) => MapEntry(k, v.toJson())),
        'current': current?.toJson(),
      };
}
