// Brute-force protection on login/register (uses a low limit to keep the test fast).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, request, registerUser } = require('./helpers');

let server;
before(async () => {
  server = await startServer(3903, { AUTH_RATE_LIMIT: '3' });
});
after(async () => {
  await server?.stop();
});

test('failed logins are blocked after the limit, successful ones are not counted', async () => {
  const u = await registerUser(server.base);

  // Successful logins do not use up the allowance
  for (let i = 0; i < 5; i++) {
    const ok = await request(server.base, 'POST', '/api/auth/login', { body: { username: u.username, password: u.password } });
    assert.equal(ok.status, 200);
  }

  const statuses = [];
  for (let i = 0; i < 5; i++) {
    const res = await request(server.base, 'POST', '/api/auth/login', { body: { username: u.username, password: 'wrong' } });
    statuses.push(res.status);
    if (res.status === 429) assert.ok(Number(res.headers.get('retry-after')) > 0);
  }
  assert.deepEqual(statuses, [401, 401, 401, 429, 429]);
});
