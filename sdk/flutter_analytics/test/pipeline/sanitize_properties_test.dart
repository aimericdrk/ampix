import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/pipeline/event_pipeline.dart';
import 'package:myampmix_analytics/src/util/logger.dart';

void main() {
  const logger = MamLogger(enabled: false);

  test('preserves scalars, null and lists of scalars', () {
    final input = <String, Object?>{
      'a_string': 'hello',
      'a_num': 42,
      'a_double': 3.14,
      'a_bool': true,
      'a_null': null,
      'a_list': ['x', 1, true, null],
    };

    expect(sanitizeProperties(input, logger), input);
  });

  test('drops a key whose value is a nested map', () {
    final input = <String, Object?>{
      'kept': 'value',
      'nested': {'a': 1},
    };

    expect(sanitizeProperties(input, logger), {'kept': 'value'});
  });

  test('drops a key whose list contains a map', () {
    final input = <String, Object?>{
      'kept': 'value',
      'bad_list': [
        1,
        {'a': 1},
      ],
    };

    expect(sanitizeProperties(input, logger), {'kept': 'value'});
  });

  test('drops a key whose list contains a nested list', () {
    final input = <String, Object?>{
      'kept': 'value',
      'bad_list': [
        1,
        [2, 3],
      ],
    };

    expect(sanitizeProperties(input, logger), {'kept': 'value'});
  });

  test('preserves the rest of the map alongside a dropped key', () {
    final input = <String, Object?>{
      'first': 'ok',
      'nested': {'a': 1},
      'second': 2,
    };

    expect(sanitizeProperties(input, logger), {'first': 'ok', 'second': 2});
  });
}
