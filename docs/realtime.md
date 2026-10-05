# SerWish realtime (Socket.IO)

The socket only **delivers** updates. Every state change (accepting a job, starting, completing,
cancelling) goes through the REST API, which checks the rules and writes to the database. This
keeps one source of truth and means a dropped socket never loses a change.

## Connecting

```ts
import { io } from 'socket.io-client';
const socket = io(API_ORIGIN, {
  transports: ['websocket'],
  auth: { token: await auth().currentUser.getIdToken() }, // Firebase ID token
});
```

- The handshake verifies the token (with revocation) and loads the account. The account must exist,
  so call `POST /api/v1/auth/session` first.
- A failed handshake emits `connect_error` with message `Socket authentication failed`. Refresh the
  token (`getIdToken(true)`) and reconnect.
- Each socket joins `user:<uid>`. Frames over 16 KB are refused.

## Acks and errors

Send events with an ack callback. The reply is always one of:

```json
{ "ok": true, "data": {} }
{ "ok": false, "code": "VALIDATION_FAILED", "message": "..." }
```

Without an ack, failures arrive as `error:event` `{ event, code, message }`.
Codes: `VALIDATION_FAILED`, `RATE_LIMITED`, `KYC_NOT_APPROVED`, `ACTIVE_JOB`, `NOT_FOUND`, `INTERNAL`.
Each event has a per-socket rate limit (below). A bad payload can never crash the server.

## Partner events (partner accounts only)

| Event (client to server) | Payload | Limit | Notes |
| --- | --- | --- | --- |
| `partner:online` | `{ lat, lng }` | 10/min | Only KYC-approved partners (rule 4.4). Sets location and `is_online`. |
| `partner:offline` | `{}` | 10/min | Refused with `ACTIVE_JOB` while the partner holds a job. |
| `partner:location` | `{ lat, lng, heading?, speed? }` | 120/min | Send every 3 to 5 s while online. Relayed live to the customer only while the job is `en_route` or `arrived`; written to the database at most every `LOCATION_MIN_INTERVAL_MS` (4 s). |

If every partner socket disconnects, the partner is set offline after 60 s unless they reconnect.

| Event (server to client) | Payload |
| --- | --- |
| `partner:state` | `{ online }`, sent to all of the partner's devices |
| `job:offer` | JobOffer (see openapi): `{ id, bookingId, serviceName, area, distanceKm, payout, expiresAt, ... }`, 45 s window. Accept or decline over REST: `POST /job-offers/{id}/accept`. |
| `job:offer_closed` | `{ offerId, bookingId, reason: accepted_by_you, expired }` |
| `booking:updated` | partner view of a job after any change; `{ id, status: released }` when the partner dropped it |

## Booking rooms (customer and assigned partner)

| Event (client to server) | Payload | Notes |
| --- | --- | --- |
| `booking:watch` | `{ bookingId }` | Joins `booking:<id>` if you are its customer or assigned partner, else `NOT_FOUND`. Re-send after reconnecting. |
| `booking:unwatch` | `{ bookingId }` | |

| Event (server to client) | Payload |
| --- | --- |
| `booking:location` | `{ bookingId, lat, lng, heading, speed, at }` |
| `booking:updated` | customer view of the booking after any change. Also sent to `user:<uid>`, so no watch is needed for status. |
| `notification:new` | a Notification, for the bell badge (both apps) |

## Scaling note

One API instance keeps rooms in memory. Before running two or more instances, add the Socket.IO
Redis adapter so rooms work across instances (planned for Backend Phase 5).
