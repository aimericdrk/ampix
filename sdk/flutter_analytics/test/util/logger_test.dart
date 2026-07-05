import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/config.dart';
import 'package:myampmix_analytics/src/util/logger.dart';

void main() {
  // Captures whatever the logger routes through `debugPrint`. The test runner
  // always runs in a debug build (`kDebugMode == true`), so these assertions
  // exercise the level-threshold gate; the additional release gate is the
  // compile-time `kDebugMode` const, which cannot be flipped at runtime.
  late List<String> lines;
  late DebugPrintCallback originalDebugPrint;

  setUp(() {
    lines = <String>[];
    originalDebugPrint = debugPrint;
    debugPrint = (String? message, {int? wrapWidth}) {
      if (message != null) lines.add(message);
    };
  });

  tearDown(() => debugPrint = originalDebugPrint);

  group('MamLogger level threshold', () {
    test('at none, nothing logs (neither internal nor error-carrying)', () {
      const logger = MamLogger(level: MyAmpMixLogLevel.none);
      logger.log('internal diagnostic');
      logger.log('boom', Exception('kaboom'));
      expect(lines, isEmpty);
    });

    test('at error, only error-carrying diagnostics log', () {
      const logger = MamLogger(level: MyAmpMixLogLevel.error);
      logger.log('internal diagnostic');
      expect(lines, isEmpty);

      logger.log('failed', Exception('kaboom'));
      expect(lines, hasLength(1));
      expect(lines.single, contains('failed'));
      expect(lines.single, contains('kaboom'));
    });

    test('at warn/info, error-carrying logs but internal diagnostics do not',
        () {
      for (final level in [MyAmpMixLogLevel.warn, MyAmpMixLogLevel.info]) {
        lines.clear();
        final logger = MamLogger(level: level);
        logger.log('internal diagnostic');
        expect(lines, isEmpty, reason: 'internal must stay silent at $level');
        logger.log('failed', Exception('kaboom'));
        expect(lines, hasLength(1), reason: 'error must surface at $level');
      }
    });

    test('at debug, everything logs', () {
      const logger = MamLogger(level: MyAmpMixLogLevel.debug);
      logger.log('internal diagnostic');
      expect(lines, hasLength(1));
      expect(lines.single, contains('internal diagnostic'));

      logger.log('failed', Exception('kaboom'));
      expect(lines, hasLength(2));
      expect(lines[1], contains('failed'));
    });

    test('a stack trace is printed as its own line at debug', () {
      const logger = MamLogger(level: MyAmpMixLogLevel.debug);
      logger.log('failed', Exception('kaboom'), StackTrace.current);
      expect(lines, hasLength(2));
      expect(lines.first, contains('failed'));
      // Second line is the stack trace itself (no [MyAmpMix] prefix).
      expect(lines[1], isNot(contains('[MyAmpMix]')));
    });

    test('default level is none (silent)', () {
      const logger = MamLogger();
      logger.log('internal diagnostic');
      logger.log('boom', Exception('kaboom'));
      expect(lines, isEmpty);
    });
  });

  group('MamLogger.fromConfig / effectiveLogLevel', () {
    test('default config is silent', () {
      const config = MyAmpMixConfig(serverUrl: 'http://localhost:8080');
      expect(config.logLevel, MyAmpMixLogLevel.none);
      expect(config.effectiveLogLevel, MyAmpMixLogLevel.none);

      MamLogger.fromConfig(config)
        ..log('internal diagnostic')
        ..log('boom', Exception('kaboom'));
      expect(lines, isEmpty);
    });

    test('legacy debug:true promotes effective level to debug', () {
      const config = MyAmpMixConfig(
        serverUrl: 'http://localhost:8080',
        debug: true,
      );
      expect(config.effectiveLogLevel, MyAmpMixLogLevel.debug);

      MamLogger.fromConfig(config).log('internal diagnostic');
      expect(lines, hasLength(1));
    });

    test('explicit logLevel wins over legacy debug flag', () {
      const config = MyAmpMixConfig(
        serverUrl: 'http://localhost:8080',
        debug: true,
        logLevel: MyAmpMixLogLevel.error,
      );
      expect(config.effectiveLogLevel, MyAmpMixLogLevel.error);

      final logger = MamLogger.fromConfig(config);
      logger.log('internal diagnostic');
      expect(lines, isEmpty);
      logger.log('failed', Exception('kaboom'));
      expect(lines, hasLength(1));
    });
  });
}
