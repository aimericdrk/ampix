/// One operation, exactly as sent in the `operations` array of
/// `POST /ingest/profiles` (shared-contracts §4).
class ProfileOperation {
  const ProfileOperation({
    required this.distinctId,
    required this.op,
    required this.properties,
    required this.timestamp,
  });

  factory ProfileOperation.fromJson(Map<String, dynamic> json) =>
      ProfileOperation(
        distinctId: json['distinct_id'] as String,
        op: json['op'] as String,
        properties: (json['properties'] as Map<String, dynamic>?) ?? const {},
        timestamp: json['timestamp'] as int,
      );

  final String distinctId;

  /// `set | set_once | increment | append | unset | delete`.
  final String op;
  final Map<String, Object?> properties;
  final int timestamp;

  Map<String, Object?> toJson() => {
    'distinct_id': distinctId,
    'op': op,
    'properties': properties,
    'timestamp': timestamp,
  };
}
