// MyAmpix runtime configuration.
// This file is loaded before the app bundle and is REPLACED at deploy time —
// the same static build works against any backend origin.
window.___MYAMPIX_CONFIG__ = {
  // '' = same origin (Vite dev proxy locally, reverse proxy in prod).
  // Or an absolute origin, e.g. 'https://api.myampix.example'.
  apiBaseUrl: '',
  // mobile_purchase (billing-authority / MyRevenueCat) service origin. It's a DISTINCT backend
  // from apiBaseUrl (both expose /api/v1/projects/:id/…), so it can't be same-origin in dev.
  // Local mobile_purchase dev server; X1 sets the prod origin at deploy time.
  purchaseApiBaseUrl: 'http://localhost:8090',
};
