 Where every environment variable lives

  There are five files, all on this server at /home/ubuntu/atclub_analytics/, all mode 600 and gitignored — plus one Secret that has no file behind it at all (the Google service account, loaded straight into the cluster):

  ┌─────────────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┬───────────────────────────────────────────────────────┐
  │              File               │                                                          What's in it                                                           │                How it reaches the app                 │
  ├─────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────┤
  │ infra/.env.prod                 │ 3 datastore passwords + BIND_IP                                                                                                 │ Read by docker compose only. Never enters Kubernetes. │
  ├─────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────┤
  │ infra/k8s/secrets/analytics.env │ DATABASE_URL, REDIS_URL, CLICKHOUSE_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, TOTP_ENC_KEY                               │ → Secret myampix-analytics                            │
  ├─────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────┤
  │ infra/k8s/secrets/purchase.env  │ DATABASE_URL, STORE_CREDENTIALS_ENC_KEY, GOOGLE_PUBSUB_SHARED_SECRET                                                            │ → Secret myampix-purchase                             │
  ├─────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────┤
  │ infra/k8s/secrets/admin.env     │ admin DB URL, probe URLs, TOTP_ENC_KEY, default login                                                                           │ → Secret myampix-admin                                │
  ├─────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────┤
  │ infra/values.prod.yaml          │ non-secret env under analytics.env: — SIGNUP_ENABLED, COOKIE_SECURE, LOG_LEVEL, FIREBASE_STORAGE_BUCKET, ClickHouse URL/user/db │ → ConfigMap myampix-analytics-config                  │
  ├─────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────┤
  │ (no file — Secret only)         │ Google service-account JSON for Firebase Storage screenshots                                                                    │ → Secret myampix-google-credentials                   │
  └─────────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┴───────────────────────────────────────────────────────┘

  The pod gets both, in this order:

  envFrom: myampix-analytics-config   (ConfigMap — from values.prod.yaml)
  envFrom: myampix-analytics          (Secret    — from analytics.env)

  Editing a file changes nothing on its own. The Secret is a copy. You must run:

  cd /home/ubuntu/atclub_analytics
  scripts/k8s/secrets.sh                                  # for the three *.env files
  kubectl -n myampix rollout restart deploy/mobile-analytics

  For values.prod.yaml it's scripts/k8s/deploy.sh <tag> instead, since that goes through Helm.

  So MISTRAL_API_KEY is a secret → append to infra/k8s/secrets/analytics.env, then secrets.sh + rollout restart.

  The Firebase service account

  I've now built the mount, so there's a real answer. Put the JSON anywhere on this server — it gets loaded into a Kubernetes Secret and the original file is no longer needed:

  cd /home/ubuntu/atclub_analytics
  scripts/k8s/firebase-credentials.sh /path/to/your-service-account.json

  The script validates the file first. It rejects an OAuth client JSON (the classic wrong download — it looks similar but has no private_key), non-JSON, and a missing file. I tested all four cases.

  Then two edits in infra/values.prod.yaml:

  analytics:
    googleCredentials:
      enabled: true
    env:
      FIREBASE_STORAGE_BUCKET: app-sport-analytics

  and scripts/k8s/deploy.sh <tag>.

  The bucket value is the plain GCS bucket name — no gs:// prefix. firebase-admin takes a name, not a URI.

  GOOGLE_APPLICATION_CREDENTIALS is not something you set — the chart derives it from the mount path so the two can't drift. Verified rendering:

  GOOGLE_APPLICATION_CREDENTIALS: "/var/run/secrets/google/service-account.json"
  mountPath: /var/run/secrets/google   readOnly: true   defaultMode: 0440   fsGroup: 999

  The JSON never enters the repo, the image, or the values file — only the Secret, projected read-only and readable only by the container's group.

  On the mode: 0400 is the tempting choice and it is wrong. Kubernetes projects Secret volumes root-owned, the pod runs as 999, so 0400 means readable by root only and the container gets EACCES — the backend logs "✗ Firebase Storage NOT reachable" and every screenshot upload fails. The chart sets fsGroup: 999 (kubelet chowns the volume to that GID) plus 0440, which is the tightest mode the container can actually open.

  Status: live since 2026-08-26 — bucket gs://app-sport-analytics, project app-sport-7f225. Both analytics pods log "✓ Firebase Storage reachable" at boot. Setting enabled: false makes the chart render zero references to the Secret again, and screenshots fall back to the in-memory store.

