/**
 * Simulated provider for development, tests and demo servers.
 * DigiLocker opens a page on this API (Allow / Deny); face and bank checks
 * pass unless the input asks to fail:
 *   - a selfie whose bytes contain "NOMATCH" fails the face match, "NOTLIVE" fails liveness
 *   - an account number starting with 000 is invalid; one starting with 999 returns a different name
 */
const sessions = new Map(); // ref -> { status, name, createdAt }

export const fakeDecide = (ref, allow) => {
  const s = sessions.get(ref);
  if (!s) return false;
  s.status = allow ? 'authenticated' : 'denied';
  return true;
};

const last4Of = (s) => String([...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 10000, 7)).padStart(4, '0');

export const fakeProvider = {
  name: 'fake',
  digilockerAvailable: true,
  startDigilocker: async ({ ref, baseUrl, name }) => {
    sessions.set(ref, { status: 'pending', name: name || 'SerWish Partner', createdAt: Date.now() });
    if (sessions.size > 5000) sessions.delete(sessions.keys().next().value);
    return {
      consentUrl: `${baseUrl}/api/v1/providers/kyc/fake-digilocker?ref=${encodeURIComponent(ref)}`,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    };
  },
  digilockerStatus: async (ref) => sessions.get(ref)?.status ?? 'expired',
  fetchAadhaar: async (ref) => {
    const s = sessions.get(ref);
    if (!s || s.status !== 'authenticated') return null;
    return {
      name: s.name.toUpperCase(),
      dob: '1994-05-17',
      gender: 'M',
      city: 'Gurugram',
      state: 'Haryana',
      pincode: '122018',
      last4: last4Of(s.name),
      photo: null,
    };
  },
  checkFace: async ({ selfie }) => {
    const text = selfie.buffer.toString('latin1');
    if (text.includes('NOTLIVE'))
      return {
        liveness: false,
        livenessReason: 'Take the selfie live, not a photo of a photo.',
        match: null,
        score: null,
      };
    const match = !text.includes('NOMATCH');
    return { liveness: true, match, score: match ? 0.93 : 0.31 };
  },
  verifyBank: async ({ accountNumber, name }) => {
    if (accountNumber.startsWith('000')) return { valid: false, nameAtBank: null, score: null };
    if (accountNumber.startsWith('999')) return { valid: true, nameAtBank: 'SOMEONE ELSE', score: 10 };
    return { valid: true, nameAtBank: String(name).toUpperCase(), score: 100 };
  },
};
