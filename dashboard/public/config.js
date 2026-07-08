// MyAmpix runtime configuration.
// This file is loaded before the app bundle and is REPLACED at deploy time —
// the same static build works against any backend origin.
window.___MYAMPIX_CONFIG__ = {
  // '' = same origin (Vite dev proxy locally, reverse proxy in prod).
  // Or an absolute origin, e.g. 'https://api.myampix.example'.
  apiBaseUrl: '',
};
