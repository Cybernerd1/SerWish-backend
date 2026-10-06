/** Cashfree adapter: request shapes and response mapping (network mocked). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cashfreeProvider as cf } from '../src/services/kyc/providers/cashfree.js';

const reply = (status, body) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

afterEach(() => vi.unstubAllGlobals());

describe('Cashfree Secure ID adapter', () => {
  it('starts DigiLocker for Aadhaar with our redirect and reference', async () => {
    const fetch = vi.fn(() =>
      reply(200, {
        verification_id: 'swdl_x',
        url: 'https://verification-test.cashfree.com/dgl/abc',
        status: 'PENDING',
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const r = await cf.startDigilocker({ ref: 'swdl_x', redirectUrl: 'https://api.serwish.in/r' });
    expect(r.consentUrl).toBe('https://verification-test.cashfree.com/dgl/abc');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://sandbox.cashfree.com/verification/digilocker');
    expect(init.method).toBe('POST');
    expect(init.headers).toHaveProperty('x-client-id');
    expect(JSON.parse(init.body)).toEqual({
      verification_id: 'swdl_x',
      document_requested: ['AADHAAR'],
      redirect_url: 'https://api.serwish.in/r',
      user_flow: 'signin',
    });
  });

  it('maps DigiLocker statuses', async () => {
    for (const [cfStatus, ours] of [
      ['PENDING', 'pending'],
      ['AUTHENTICATED', 'authenticated'],
      ['EXPIRED', 'expired'],
      ['CONSENT_DENIED', 'denied'],
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => reply(200, { status: cfStatus })),
      );
      expect(await cf.digilockerStatus('swdl_x')).toBe(ours);
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(() => reply(404, { message: 'not found' })),
    );
    expect(await cf.digilockerStatus('swdl_x')).toBe('expired');
  });

  it('keeps only masked Aadhaar fields and converts the date of birth', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        reply(200, {
          status: 'SUCCESS',
          uid: 'xxxxxxxx5647',
          dob: '02-02-1995',
          gender: 'M',
          name: 'Mallesh Dollin',
          photo_link: Buffer.from('jpegbytes').toString('base64'),
          xml_file: 'https://example/xml',
          split_address: { dist: 'Haveri', state: 'Karnataka', pincode: '581115' },
        }),
      ),
    );
    const a = await cf.fetchAadhaar('swdl_x');
    expect(a).toMatchObject({
      name: 'Mallesh Dollin',
      dob: '1995-02-02',
      gender: 'M',
      last4: '5647',
      city: 'Haveri',
      state: 'Karnataka',
      pincode: '581115',
    });
    expect(a.photo.toString()).toBe('jpegbytes');
    expect(JSON.stringify(a)).not.toContain('xml');
  });

  it('runs liveness then face match, and stops when the face is not live', async () => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => reply(200, { status: 'SUCCESS', liveness: true, liveness_score: 0.98 }))
      .mockImplementationOnce(() =>
        reply(200, { status: 'SUCCESS', face_match_result: 'YES', face_match_score: 0.91 }),
      );
    vi.stubGlobal('fetch', fetch);
    const file = { buffer: Buffer.from('x'), type: 'image/jpeg' };
    expect(await cf.checkFace({ ref: 'r', selfie: file, reference: file })).toEqual({
      liveness: true,
      match: true,
      score: 0.91,
    });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      'https://sandbox.cashfree.com/verification/face-liveness',
      'https://sandbox.cashfree.com/verification/face-match',
    ]);
    expect(fetch.mock.calls[1][1].body.get('threshold')).toBe('0.75');

    vi.stubGlobal(
      'fetch',
      vi.fn(() => reply(200, { status: 'REAL_FACE_NOT_DETECTED' })),
    );
    const spoof = await cf.checkFace({ ref: 'r', selfie: file, reference: file });
    expect(spoof).toMatchObject({ liveness: false, match: null });
  });

  it('bank: valid account with name, invalid account, and outages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => reply(200, { account_status: 'VALID', name_at_bank: 'JOHN DOE', name_match_score: '90.00' })),
    );
    expect(await cf.verifyBank({ accountNumber: '26291800001191', ifsc: 'YESB0000001', name: 'John Doe' })).toEqual({
      valid: true,
      nameAtBank: 'JOHN DOE',
      score: 90,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => reply(200, { account_status: 'INVALID' })),
    );
    expect((await cf.verifyBank({ accountNumber: '1', ifsc: 'YESB0000001', name: 'x' })).valid).toBe(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => reply(500, {})),
    );
    await expect(cf.verifyBank({ accountNumber: '1', ifsc: 'YESB0000001', name: 'x' })).rejects.toMatchObject({
      status: 503,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNRESET'))),
    );
    await expect(cf.digilockerStatus('r')).rejects.toMatchObject({ status: 503 });
  });
});
