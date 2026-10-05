/**
 * In-memory stand-in for firebase-admin Auth. Tokens are opaque strings that
 * map to decoded claims; anything else fails like a bad Firebase token.
 */
export const makeFakeAuth = () => {
  const tokens = new Map();
  const revoked = new Set();
  return {
    tokens,
    revoked,
    /** Register a token for a uid and return it. */
    issue(uid, claims = {}) {
      const token = `test-token-${uid}-${Math.random().toString(36).slice(2, 12)}`;
      tokens.set(token, {
        uid,
        exp: Math.floor(Date.now() / 1000) + 3600,
        firebase: { sign_in_provider: 'google.com' },
        ...claims,
      });
      return token;
    },
    async verifyIdToken(token, checkRevoked) {
      const decoded = tokens.get(token);
      if (!decoded) throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' });
      if (decoded.exp * 1000 < Date.now()) throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' });
      if (checkRevoked && revoked.has(decoded.uid))
        throw Object.assign(new Error('revoked'), { code: 'auth/id-token-revoked' });
      return decoded;
    },
    async revokeRefreshTokens(uid) {
      revoked.add(uid);
    },
  };
};
