import { describe, expect, it } from 'vitest';
import { nameScore, displayName } from '../src/services/kyc/names.js';
import { sniff } from '../src/services/kyc/files.js';
import { kycHash } from '../src/services/kyc/hash.js';
import { toKyc, KYC_CONSENT_VERSION } from '../src/utils/kycDto.js';

describe('name matching', () => {
  it('matches the same name in any case, order or honorific', () => {
    expect(nameScore('Ravi Kumar', 'RAVI KUMAR')).toBe(100);
    expect(nameScore('Kumar Ravi', 'Mr. Ravi Kumar')).toBe(100);
  });
  it('gives partial credit for initials and extra words', () => {
    const s = nameScore('R. Kumar', 'Ravi Kumar');
    expect(s).toBeGreaterThanOrEqual(70);
    expect(s).toBeLessThan(100);
    expect(nameScore('Ravi Kumar', 'Ravi Kumar Sharma')).toBeGreaterThanOrEqual(90);
  });
  it('scores different people low', () => {
    expect(nameScore('Ravi Kumar', 'Sunita Devi')).toBe(0);
    expect(nameScore('', 'Ravi')).toBe(0);
  });
  it('normalises names for display', () => {
    expect(displayName('  mr. ravi   kumar ')).toBe('RAVI KUMAR');
  });
});

describe('upload content checks', () => {
  it('recognises images and PDFs by their bytes, not their names', () => {
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))?.type).toBe('image/jpeg');
    expect(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))?.type).toBe('image/png');
    expect(sniff(Buffer.from('%PDF-1.7 hello world'))?.type).toBe('application/pdf');
    expect(sniff(Buffer.from('<?php echo 1; ?> padding'))).toBeNull();
    expect(sniff(Buffer.from([1, 2]))).toBeNull();
  });
});

describe('hashes', () => {
  it('are stable, normalised and 64 hex chars', () => {
    const a = kycHash('bank', '1234 5678 9012', 'sbin');
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(kycHash('bank', '123456789012', 'SBIN')).toBe(a);
    expect(kycHash('bank', '123456789013', 'SBIN')).not.toBe(a);
  });
});

describe('kyc state', () => {
  const profile = (status) => ({ kyc_status: status, kyc_submitted_at: null, kyc_reviewed_at: null });
  it('lists what is missing and blocks submit until done', () => {
    const k = toKyc(profile('not_started'), null, { digilockerAvailable: true });
    expect(k.missing).toEqual(['consent', 'identity', 'selfie', 'bank']);
    expect(k.canSubmit).toBe(false);
    expect(k.steps.selfie.attemptsLeft).toBe(3);
  });
  it('allows submit once every required step is done or in review', () => {
    const row = {
      consent_at: '2026-10-06T00:00:00Z',
      consent_version: KYC_CONSENT_VERSION,
      id_state: 'done',
      selfie_state: 'review',
      bank_state: 'done',
      cert_state: 'todo',
      bank_account_last4: '9012',
    };
    expect(toKyc(profile('in_progress'), row, { digilockerAvailable: false }).canSubmit).toBe(true);
    const needsCert = toKyc(profile('in_progress'), row, { digilockerAvailable: false, certRequired: true });
    expect(needsCert.missing).toEqual(['certificate']);
    expect(toKyc(profile('pending'), row, { digilockerAvailable: false }).canSubmit).toBe(false);
  });
  it('asks for consent again when the terms version changes', () => {
    const k = toKyc(
      profile('in_progress'),
      { consent_at: 'x', consent_version: 'partner-kyc-v0' },
      { digilockerAvailable: true },
    );
    expect(k.consent.accepted).toBe(false);
  });
});
