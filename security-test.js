import axios from 'axios';

const BASE_URL = 'http://localhost:5000/api/v1';

const testSecurity = async () => {
    console.log('🛡️ Starting SerWish Security Audit...\n');

    // --- TEST 1: Unauthorized Access ---
    process.stdout.write('1. Checking No-Auth Protection... ');
    try {
        await axios.get(`${BASE_URL}/users/me`);
        console.log('🔴 FAILED! (Endpoint should be protected)');
    } catch (err) {
        if (err.response?.status === 401) {
            console.log('🟢 PASSED (401 Unauthorized)');
        } else {
            console.log('🟠 ERROR: ', err.response?.status);
        }
    }

    // --- TEST 2: Role Access (Provider Endpoint) ---
    process.stdout.write('2. Checking Provider-Only Guard... ');
    try {
        await axios.get(`${BASE_URL}/providers/earnings`);
        console.log('🔴 FAILED! (Should be protected)');
    } catch (err) {
        if (err.response?.status === 401 || err.response?.status === 403) {
            console.log('🟢 PASSED (Protected)');
        } else {
            console.log('🟠 ERROR: ', err.response?.status);
        }
    }

    // --- TEST 3: Input Validation ---
    process.stdout.write('3. Checking Input Validation (Bad Payload)... ');
    try {
        await axios.post(`${BASE_URL}/auth/verify-otp`, {
            phone: '123', // should be 10 digits
            otp: 'abc' // should be numeric 6 digits
        });
        console.log('🔴 FAILED! (Validator didn\'t catch bad data)');
    } catch (err) {
        if (err.response?.status === 422) {
            console.log(`🟢 PASSED (422 Invalid Data) — Errors: ${err.response.data.errors.length}`);
        } else {
            console.log('🟠 ERROR: ', err.response?.status);
        }
    }

    // --- TEST 4: Rate Limiting ---
    process.stdout.write('4. Testing Rate Limiter (Hammering OTP API)... ');
    let hits = 0;
    try {
        for(let i=0; i<7; i++) {
            await axios.post(`${BASE_URL}/auth/send-otp`, { phone: '9000000000' });
            hits++;
        }
        console.log('🔴 FAILED! (No rate limiting triggered after 6 hits)');
    } catch (err) {
        if (err.response?.status === 429) {
            console.log('🟢 PASSED (429 Too Many Requests)');
        } else {
            console.log(`🟠 HITS: ${hits}, ERROR: ${err.response?.status}`);
        }
    }

    console.log('\n✅ Security audit complete.');
};

testSecurity();
