// Diagnoses the Firebase Storage screenshot pipeline independently of the SDK/backend.
// It loads backend/.env, resolves your credentials + bucket exactly like the backend does,
// uploads a tiny test object, and lists what's under screens/. Any auth/permission/bucket
// problem surfaces here with a clear error.
//
// Run it from the backend/ dir so it uses backend/node_modules (firebase-admin) and loads backend/.env:
//     cd backend && node ../scripts/firebase-storage-check.mjs
//
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

try {
  process.loadEnvFile(); // loads ./.env from the CURRENT working directory (run from backend/)
} catch {
  console.warn('No .env in the current directory — relying on the real environment.');
}

const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

console.log('cwd                              =', process.cwd());
console.log('FIREBASE_STORAGE_BUCKET          =', bucketName || '(NOT SET)');
console.log('GOOGLE_APPLICATION_CREDENTIALS   =', credPath || '(NOT SET — will try Application Default Credentials)');
if (credPath) {
  const absolute = resolve(process.cwd(), credPath);
  console.log('  → resolves to                  =', absolute);
  console.log('  → file exists?                 =', existsSync(absolute) ? 'YES' : 'NO  ← this is the problem if NO');
}
if (!bucketName) {
  console.error('\nFIREBASE_STORAGE_BUCKET is not set → the backend uses the in-memory store (nothing reaches the bucket).');
  process.exit(1);
}

const app = initializeApp({ credential: applicationDefault(), storageBucket: bucketName });
const bucket = getStorage(app).bucket(bucketName);

const path = `screens/_diagnostic/hello.txt`;
console.log(`\nUploading test object gs://${bucketName}/${path} …`);
await bucket.file(path).save(Buffer.from('myampmix firebase storage check'), {
  contentType: 'text/plain',
  resumable: false,
});
console.log('✓ upload succeeded — credentials + bucket + write permission all work.');

const [files] = await bucket.getFiles({ prefix: 'screens/' });
console.log(`\nObjects currently under screens/ (${files.length}):`);
for (const f of files) console.log('  -', f.name);
console.log('\nIf this succeeded but real screenshots still are not appearing, the issue is on the SDK side');
console.log('(see the "once per app version" note) — not Firebase.');
