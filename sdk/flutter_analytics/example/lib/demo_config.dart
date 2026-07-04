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

/// Placeholder ingest token: `mam_` followed by 32 hex zeros.
///
/// This is NOT a real token, it only lets the SDK initialize without
/// crashing. Replace it with the token printed by `pnpm dev`'s demo seed
/// (run from the repo root) to see events actually accepted by your local
/// MyAmpMix backend — otherwise every batch the SDK uploads will be
/// rejected with 401 Unauthorized. The app still runs normally either way,
/// and the on-screen Event Log still shows every call made to the SDK,
/// because the SDK is designed to never throw into the host app regardless
/// of network or auth failures.
const String demoToken = 'mam_00000000000000000000000000000000';
