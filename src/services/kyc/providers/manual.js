/**
 * No automatic checks: DigiLocker is hidden in the app, and selfies and bank
 * accounts go to the admin review queue. The default until a provider contract exists.
 */
export const manualProvider = {
  name: 'manual',
  digilockerAvailable: false,
  startDigilocker: async () => {
    throw new Error('DigiLocker is not configured');
  },
  digilockerStatus: async () => 'failed',
  fetchAadhaar: async () => null,
  checkFace: async () => null,
  verifyBank: async () => null,
};
