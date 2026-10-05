import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { resolveServiceAccount } from '../src/config/firebase.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const account = {
  project_id: 'serwish-test',
  client_email: 'sa@serwish-test.iam.gserviceaccount.com',
  private_key: pem,
};

describe('Firebase credentials', () => {
  it('reads raw JSON', () => {
    const r = resolveServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(account) });
    expect(r.projectId).toBe('serwish-test');
    expect(r.privateKey).toContain('BEGIN PRIVATE KEY');
  });

  it('reads base64 JSON', () => {
    const b64 = Buffer.from(JSON.stringify(account)).toString('base64');
    expect(resolveServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: b64 }).clientEmail).toBe(account.client_email);
  });

  it('accepts the three variables with escaped newlines and quotes', () => {
    const escaped = `"${pem.replace(/\n/g, '\\n')}"`;
    const r = resolveServiceAccount({
      FIREBASE_PROJECT_ID: 'p',
      FIREBASE_CLIENT_EMAIL: 'e@x.com',
      FIREBASE_PRIVATE_KEY: escaped,
    });
    expect(() => crypto.createPrivateKey(r.privateKey)).not.toThrow();
  });

  it('accepts a key copied out of the JSON with its closing quote and trailing comma', () => {
    const r = resolveServiceAccount({
      FIREBASE_PROJECT_ID: 'p',
      FIREBASE_CLIENT_EMAIL: 'e@x.com',
      FIREBASE_PRIVATE_KEY: `"${pem}",`,
    });
    expect(() => crypto.createPrivateKey(r.privateKey)).not.toThrow();
  });

  it('rebuilds a key whose newlines became spaces', () => {
    const r = resolveServiceAccount({
      FIREBASE_PROJECT_ID: 'p',
      FIREBASE_CLIENT_EMAIL: 'e@x.com',
      FIREBASE_PRIVATE_KEY: pem.replace(/\n/g, ' '),
    });
    expect(() => crypto.createPrivateKey(r.privateKey)).not.toThrow();
  });

  it('rebuilds a key whose whitespace was stripped entirely', () => {
    const r = resolveServiceAccount({
      FIREBASE_PROJECT_ID: 'p',
      FIREBASE_CLIENT_EMAIL: 'e@x.com',
      FIREBASE_PRIVATE_KEY: pem.replace(/\s+/g, ''),
    });
    expect(() => crypto.createPrivateKey(r.privateKey)).not.toThrow();
  });

  it('accepts CRLF line endings from dashboard editors', () => {
    const r = resolveServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...account, private_key: pem.replace(/\n/g, '\r\n') }) });
    expect(() => crypto.createPrivateKey(r.privateKey)).not.toThrow();
  });

  it('explains a mangled key instead of failing on first login', () => {
    expect(() =>
      resolveServiceAccount({ FIREBASE_PROJECT_ID: 'p', FIREBASE_CLIENT_EMAIL: 'e', FIREBASE_PRIVATE_KEY: 'abc' }),
    ).toThrow(/private key from FIREBASE_PRIVATE_KEY could not be parsed/);
    expect(() => resolveServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: '{nope' })).toThrow(/not valid JSON/);
  });

  it('names the source and shape in the error without leaking the key', () => {
    const truncated = `${pem.slice(0, 120)}\n-----END PRIVATE KEY-----\n`;
    try {
      resolveServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...account, private_key: truncated }) });
      expect.unreachable();
    } catch (err) {
      expect(err.message).toMatch(/FIREBASE_SERVICE_ACCOUNT_JSON/);
      expect(err.message).toMatch(/beginMarker=true, endMarker=true/);
      expect(err.message).not.toContain(truncated.slice(40, 80));
    }
  });

  it('returns null when nothing is configured', () => {
    expect(resolveServiceAccount({})).toBeNull();
  });
});
