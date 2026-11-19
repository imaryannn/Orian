const { test } = require('node:test');
const assert = require('node:assert/strict');
const clerkPath = require.resolve('@clerk/express');
let received;
require.cache[clerkPath] = { id: clerkPath, filename: clerkPath, loaded: true, exports: { verifyToken: async (token, options) => {
  received = { token, options };
  if (token !== 'valid-session') throw new Error('Invalid token');
  return { sub: 'user_123' };
} } };
const { setupSocket } = require('../sockets/socket');
let authenticate;
setupSocket({ use: fn => { authenticate = fn; }, on() {} });
test('socket handshake supplies Clerk verification options and authenticates the owner', async () => {
  const original = process.env.CLERK_SECRET_KEY;
  process.env.CLERK_SECRET_KEY = 'test-secret';
  try {
    const socket = { handshake: { auth: { token: 'valid-session' } } };
    let failure;
    await authenticate(socket, error => { failure = error; });
    assert.equal(failure, undefined);
    assert.equal(socket.userId, 'user_123');
    assert.deepEqual(received, { token: 'valid-session', options: { secretKey: 'test-secret' } });
  } finally {
    if (original === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = original;
  }
});
test('socket handshake still rejects missing or invalid tokens', async () => {
  for (const token of [undefined, 'invalid']) {
    let failure;
    await authenticate({ handshake: { auth: { token } } }, error => { failure = error; });
    assert.equal(failure?.message, 'unauthorized');
  }
});
