// Sign a PostgREST JWT for a role (tests only). Usage: node scripts/make-test-jwt.mjs service_role <secret>
import crypto from 'node:crypto';

const [role = 'service_role', secret] = process.argv.slice(2);
if (!secret || secret.length < 32) {
  console.error('Pass a JWT secret of at least 32 characters');
  process.exit(1);
}
const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = part({ alg: 'HS256', typ: 'JWT' });
const body = part({ role, iss: 'serwish-tests', exp: Math.floor(Date.now() / 1000) + 3600 });
const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
console.log(`${head}.${body}.${sig}`);
