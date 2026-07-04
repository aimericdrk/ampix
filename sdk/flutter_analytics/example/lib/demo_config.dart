/// Demo configuration for the MyAmpMix analytics example app.
///
/// These are intentionally plain top-level `const`s (no `--dart-define` /
/// env plumbing) so the example stays copy-pasteable.
library;

/// Base URL of the MyAmpMix backend the demo app talks to.
///
/// Defaults to `http://localhost:8080`, which works when running on a real
/// device, desktop, or iOS simulator alongside a MyAmpMix backend on this
/// machine. Android emulators cannot reach the host's `localhost` directly
/// — use `http://10.0.2.2:8080` instead (the emulator's special alias for
/// the host loopback interface) when running on the Android emulator.
const String demoServerUrl = 'http://localhost:8080';

/// Demo ingest token: `mam_` followed by 32 hex zeros.
///
/// Running `pnpm dev` from the repo root seeds this EXACT token into the local
/// backend, so events from this example are accepted (202) out of the box — no
/// edit needed. If the backend is not running (or you point at a different
/// server), uploads get 401, but the app still runs normally and the on-screen
/// Event Log still shows every SDK call, because the SDK never throws into the
/// host app regardless of network or auth failures.
const String demoToken = 'mam_00000000000000000000000000000000';
