/// Demo configuration for the MyAmpix purchases example app.
///
/// Values come from `--dart-define` so the demo is runnable against a real
/// `mobile_purchase` deployment without editing source (`flutter run
/// --dart-define=MP_API_KEY=mp_pub_... --dart-define=MP_SERVER_URL=https://...`).
/// Falling back to clearly-fake placeholders keeps `flutter run`/`flutter test`
/// working with zero setup.
library;

/// Base URL of the `mobile_purchase` backend the demo app talks to.
///
/// Defaults to `http://localhost:8088`, which works on a real device, desktop,
/// or the iOS simulator alongside a `mobile_purchase` backend on this machine.
/// The Android emulator cannot reach the host's `localhost` — use
/// `http://10.0.2.2:8088` instead (the emulator's alias for the host loopback).
/// Override with `--dart-define=MP_SERVER_URL=https://your-host`.
const String demoServerUrl = String.fromEnvironment(
  'MP_SERVER_URL',
  defaultValue: 'http://localhost:8088',
);

/// Demo PUBLIC SDK key: `mp_pub_` followed by 32 hex zeros.
///
/// This is a placeholder public key. A real `mobile_purchase` deployment will
/// reject it (401) — replace it with the `mp_pub_` key printed for your app
/// via `--dart-define=MP_API_KEY=mp_pub_...`. The demo still runs regardless:
/// the SDK never throws internal machinery into the host, and the throwing
/// read/purchase methods surface a typed `PurchasesError` the demo catches
/// and shows on screen.
const String demoApiKey = String.fromEnvironment(
  'MP_API_KEY',
  defaultValue: 'mp_pub_00000000000000000000000000000000',
);
