import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/model/profile_operation.dart';

void main() {
  test('serializes to the /ingest/profiles operation shape', () {
    const op = ProfileOperation(
      distinctId: 'u_42',
      op: 'set',
      properties: {'plan': 'pro'},
      timestamp: 1751462400123,
    );
    expect(op.toJson(), {
      'distinct_id': 'u_42',
      'op': 'set',
      'properties': {'plan': 'pro'},
      'timestamp': 1751462400123,
    });
  });

  test('round-trips through json encode/decode', () {
    const op = ProfileOperation(
      distinctId: 'u_1',
      op: 'unset',
      properties: {'plan': null},
      timestamp: 7,
    );
    final decoded = ProfileOperation.fromJson(
        jsonDecode(jsonEncode(op.toJson())) as Map<String, dynamic>);
    expect(decoded.toJson(), op.toJson());
  });
}
