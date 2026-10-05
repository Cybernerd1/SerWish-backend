# Security actions for the owner

These steps cannot be done in code. Do them before the backend goes on a public server.

## 1. Rotate the Supabase database password (urgent)

`test-db.js` contained a working database password and it is in the git history (audit BE-X1).
The file is now empty, but the old password still works until you change it.

1. Supabase dashboard > Project Settings > Database > **Reset database password**.
2. Update any tool that used the old connection string (only `test-db.js` did).
3. While there, also roll the **service role key** if `.env` was ever shared or committed:
   Project Settings > API > Roll. Update `SUPABASE_SERVICE_ROLE_KEY` in `.env` and on the host.

## 2. Remove the secret from git history (BE-C2)

Rotating makes the old password useless; purging stops it from being found. With
[git-filter-repo](https://github.com/newren/git-filter-repo) installed:

```bash
cd serwishbackend
git filter-repo --invert-paths --path test-db.js --path security-test.js
git push --force --all && git push --force --tags
```

Everyone with a clone must re-clone afterwards. If the repository was ever public, treat every
secret that was ever in it as leaked and rotate it.

## 3. Firebase Admin key

If the Firebase private key was ever in a committed file, delete that key in Google Cloud Console >
IAM > Service accounts > firebase-adminsdk > Keys, create a new one, and set it as
`FIREBASE_SERVICE_ACCOUNT_JSON` (base64 of the JSON file) on the host.

## 4. Delete the retired files

These files are now empty stubs because files could not be deleted remotely. Delete them:

- `test-db.js`, `security-test.js`
- `src/controllers/payments.controller.js`, `reviews.controller.js`, `services.controller.js`
- `src/socket/chat.socket.js`
- `supabase/migrations/001_initial_schema.sql`, `002_v2_schema.sql`, `003_firebase_uid_migration.sql`
  (no-ops now; originals are in `supabase/legacy/` for reference)
- `logs/` (logs now go to stdout; the folder is git-ignored)

## What the code now guarantees

- Row Level Security is on for every table with no client grants: the anon key reads nothing.
- Firebase tokens are verified with revocation checks; logout and account deletion revoke sessions.
- Responses are built from allow-listed fields only, so OTP hashes, KYC document paths, exact
  partner locations and payment ids are never returned.
- Inputs are validated with zod, bodies are capped at 100 KB, socket frames at 16 KB, and every
  socket handler is rate-limited and crash-safe.
- Booking rules (state machine, one active job per partner, payment before completion, one review
  per booking, dispatcher offers one partner at a time) are enforced by the database itself.
- Booking creation needs an Idempotency-Key, so a retried request never double-books.
- Partners see only the locality of a job until they accept it; customers see the partner's live
  location only while the partner is on the way or has arrived.

## Reporting

Email security issues to the owner privately; do not open a public issue.
