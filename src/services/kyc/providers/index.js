import { env } from '../../../config/env.js';
import { manualProvider } from './manual.js';
import { fakeProvider } from './fake.js';
import { cashfreeProvider } from './cashfree.js';

const PROVIDERS = { manual: manualProvider, fake: fakeProvider, cashfree: cashfreeProvider };

let current = PROVIDERS[env.KYC_PROVIDER];

/** The configured verification provider (KYC_PROVIDER). */
export const kycProvider = () => current;

export const __setKycProviderForTests = (name) => {
  current = PROVIDERS[name ?? env.KYC_PROVIDER];
};
