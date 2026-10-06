/**
 * Test-only API server for app <-> backend contract tests (serwishapp/__tests__/e2e).
 * Real routes, sockets and dispatcher; Firebase is replaced by fixed test tokens:
 * a bearer token "e2e-token.<uid>" (uid of 10+ letters, digits, _ or -) signs in as that uid. NEVER deploy this.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... PORT=5099 node scripts/e2e-server.mjs
 */
import { createServer } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.DISPATCH_INTERVAL_MS ??= '700';
process.env.KYC_PROVIDER ??= 'fake';

const [{ createApp }, firebase, { initSocket }, dispatcher, kycStore] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/firebase.js'),
  import('../src/socket/index.js'),
  import('../src/services/dispatcher.js'),
  import('../src/services/kyc/storage.js'),
]);
// Verification photos stay in memory (a bare PostgREST has no Storage API).
kycStore.__setKycStorageForTests(kycStore.memoryStore());

const revoked = new Set();
firebase.__setFirebaseAuthForTests({
  async verifyIdToken(token, checkRevoked) {
    const m = /^e2e-token\.([A-Za-z0-9_-]{10,80})$/.exec(token);
    if (!m) throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' });
    if (checkRevoked && revoked.has(m[1])) throw Object.assign(new Error('revoked'), { code: 'auth/id-token-revoked' });
    return {
      uid: m[1],
      exp: Math.floor(Date.now() / 1000) + 3600,
      firebase: { sign_in_provider: 'google.com' },
    };
  },
  async revokeRefreshTokens(uid) {
    revoked.add(uid);
  },
});

const server = createServer(createApp());
initSocket(server);
dispatcher.startDispatcher();
const port = Number(process.env.PORT ?? 5099);
server.listen(port, () => {
  console.log(`e2e server on http://127.0.0.1:${port}`);
});
