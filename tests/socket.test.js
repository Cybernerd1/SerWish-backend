import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { io as connect } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { safeOn } from '../src/socket/safeOn.js';
import { initSocket } from '../src/socket/index.js';
import { __setFirebaseAuthForTests } from '../src/config/firebase.js';
import { forbidden } from '../src/utils/errors.js';
import { makeFakeAuth } from './helpers/fakeFirebase.js';

const fakeSocket = () => {
  const s = new EventEmitter();
  s.data = { uid: 'u1' };
  s.sent = [];
  const emitLocal = s.emit.bind(s);
  s.trigger = (event, ...args) => emitLocal(event, ...args);
  s.emit = (event, payload) => s.sent.push({ event, payload });
  return s;
};

const call = (socket, event, payload) =>
  new Promise((resolve) => {
    socket.trigger(event, payload, resolve);
  });

describe('safeOn', () => {
  it('validates payloads and acks errors without throwing', async () => {
    const s = fakeSocket();
    safeOn(s, 'ping', z.object({ n: z.number() }), ({ n }) => ({ n: n + 1 }));
    expect(await call(s, 'ping', { n: 1 })).toEqual({ ok: true, data: { n: 2 } });
    expect(await call(s, 'ping', { n: 'x' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });

  it('turns thrown errors into acks, never crashes', async () => {
    const s = fakeSocket();
    safeOn(s, 'boom', null, () => {
      throw new Error('db down');
    });
    safeOn(s, 'nope', null, async () => {
      throw forbidden('no', 'KYC_NOT_APPROVED');
    });
    expect(await call(s, 'boom', {})).toEqual({ ok: false, code: 'INTERNAL', message: 'Something went wrong' });
    expect(await call(s, 'nope', {})).toMatchObject({ ok: false, code: 'KYC_NOT_APPROVED' });
  });

  it('emits an error event when the client sent no ack', async () => {
    const s = fakeSocket();
    safeOn(s, 'boom', null, () => {
      throw new Error('x');
    });
    s.trigger('boom', {});
    await new Promise((r) => setTimeout(r, 5));
    expect(s.sent[0]).toMatchObject({ event: 'error:event', payload: { event: 'boom', code: 'INTERNAL' } });
  });

  it('rate limits per socket and event', async () => {
    const s = fakeSocket();
    safeOn(s, 'spam', null, () => 1, { perMinute: 3 });
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await call(s, 'spam', {}));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results[4].code).toBe('RATE_LIMITED');
  });

  it('survives fuzzed payloads', async () => {
    const s = fakeSocket();
    safeOn(s, 'loc', z.object({ lat: z.number().min(-90).max(90), lng: z.number() }), () => undefined, {
      perMinute: 10000,
    });
    const junk = [
      null,
      undefined,
      1,
      'x',
      [],
      {},
      { lat: 'a' },
      { lat: 1e9, lng: 1 },
      { __proto__: { lat: 1 } },
      { lat: NaN, lng: 1 },
    ];
    for (const p of junk) {
      const r = await call(s, 'loc', p);
      expect(r.ok).toBe(false);
    }
    expect((await call(s, 'loc', { lat: 28.4, lng: 77.1 })).ok).toBe(true);
  });
});

describe('socket handshake', () => {
  let server;
  let url;
  beforeAll(async () => {
    __setFirebaseAuthForTests(makeFakeAuth());
    server = createServer();
    initSocket(server);
    await new Promise((r) => server.listen(0, r));
    url = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('rejects connections without a valid token', async () => {
    for (const auth of [{}, { token: 'short' }, { token: 'x'.repeat(40) }]) {
      const err = await new Promise((resolve) => {
        const c = connect(url, { auth, transports: ['websocket'], reconnection: false });
        c.on('connect_error', (e) => {
          c.close();
          resolve(e);
        });
        c.on('connect', () => {
          c.close();
          resolve(null);
        });
      });
      expect(err?.message).toBe('Socket authentication failed');
    }
  });
});
