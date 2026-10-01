// REST API tests: auth, validation, rooms and message history.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, request, registerUser } = require('./helpers');

let server;
before(async () => {
  server = await startServer(3901);
});
after(async () => {
  await server?.stop();
});

const api = (...args) => request(server.base, ...args);

describe('health', () => {
  test('GET /api/health is public', async () => {
    const res = await api('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'ok' });
  });
});

describe('register', () => {
  test('creates a user and returns a token without the password hash', async () => {
    const res = await api('POST', '/api/auth/register', { body: { username: 'alice_1', password: 'secret123' } });
    assert.equal(res.status, 201);
    assert.ok(res.body.token);
    assert.equal(res.body.user.username, 'alice_1');
    assert.equal(res.body.user.password, undefined);
  });

  test('rejects invalid usernames and short passwords', async () => {
    for (const username of ['ab', 'has space', 'x'.repeat(21), 'bad<script>']) {
      const res = await api('POST', '/api/auth/register', { body: { username, password: 'secret123' } });
      assert.equal(res.status, 400, `username "${username}" should be rejected`);
    }
    const res = await api('POST', '/api/auth/register', { body: { username: 'shortpw', password: '123' } });
    assert.equal(res.status, 400);
  });

  test('usernames are unique regardless of case', async () => {
    await api('POST', '/api/auth/register', { body: { username: 'CaseTest', password: 'secret123' } });
    const res = await api('POST', '/api/auth/register', { body: { username: 'casetest', password: 'secret123' } });
    assert.equal(res.status, 409);
  });
});

describe('login', () => {
  test('succeeds with the right password, in any letter case', async () => {
    const u = await registerUser(server.base, 'Login');
    for (const username of [u.username, u.username.toLowerCase(), u.username.toUpperCase()]) {
      const res = await api('POST', '/api/auth/login', { body: { username, password: u.password } });
      assert.equal(res.status, 200, `login as "${username}"`);
      assert.ok(res.body.token);
    }
  });

  test('fails with a wrong password or unknown user, using the same message', async () => {
    const u = await registerUser(server.base);
    const wrongPw = await api('POST', '/api/auth/login', { body: { username: u.username, password: 'nope123' } });
    const noUser = await api('POST', '/api/auth/login', { body: { username: 'ghost_user', password: 'nope123' } });
    assert.equal(wrongPw.status, 401);
    assert.equal(noUser.status, 401);
    assert.equal(wrongPw.body.error, noUser.body.error);
  });

  test('rejects non-string credentials (NoSQL injection attempt)', async () => {
    const u = await registerUser(server.base);
    const payloads = [
      { username: { $ne: null }, password: 'secret123' },
      { username: u.username, password: { $gt: '' } },
      { username: ['a'], password: 'secret123' },
    ];
    for (const body of payloads) {
      const res = await api('POST', '/api/auth/login', { body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });
});

describe('authentication', () => {
  test('protected routes need a valid token', async () => {
    for (const route of ['/api/users', '/api/rooms', '/api/auth/me']) {
      assert.equal((await api('GET', route)).status, 401, `${route} without token`);
      assert.equal((await api('GET', route, { token: 'not.a.jwt' })).status, 401, `${route} with bad token`);
    }
  });

  test('GET /api/auth/me returns the current user', async () => {
    const u = await registerUser(server.base);
    const res = await api('GET', '/api/auth/me', { token: u.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, u.username);
  });

  test('GET /api/users lists everyone except me', async () => {
    const me = await registerUser(server.base);
    const other = await registerUser(server.base);
    const res = await api('GET', '/api/users', { token: me.token });
    const names = res.body.map((x) => x.username);
    assert.ok(names.includes(other.username));
    assert.ok(!names.includes(me.username));
    assert.ok(res.body.every((x) => x.password === undefined));
  });
});

describe('rooms', () => {
  test('default rooms exist', async () => {
    const u = await registerUser(server.base);
    const res = await api('GET', '/api/rooms', { token: u.token });
    const names = res.body.map((r) => r.name);
    assert.ok(names.includes('General'));
    assert.ok(names.includes('Random'));
  });

  test('create a room, reject duplicates and bad names', async () => {
    const u = await registerUser(server.base);
    const created = await api('POST', '/api/rooms', { token: u.token, body: { name: 'design-review', description: 'Weekly' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.name, 'design-review');

    const dup = await api('POST', '/api/rooms', { token: u.token, body: { name: 'Design-Review' } });
    assert.equal(dup.status, 409);

    const bad = await api('POST', '/api/rooms', { token: u.token, body: { name: 'x' } });
    assert.equal(bad.status, 400);
  });
});

describe('message history', () => {
  test('rejects invalid ids and dates with 400', async () => {
    const u = await registerUser(server.base);
    const rooms = (await api('GET', '/api/rooms', { token: u.token })).body;
    assert.equal((await api('GET', '/api/messages/room/not-an-id', { token: u.token })).status, 400);
    assert.equal((await api('GET', '/api/messages/dm/not-an-id', { token: u.token })).status, 400);
    assert.equal((await api('GET', `/api/messages/room/${rooms[0]._id}?before=garbage`, { token: u.token })).status, 400);
    const ok = await api('GET', `/api/messages/room/${rooms[0]._id}?before=${new Date().toISOString()}`, { token: u.token });
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray(ok.body));
  });
});
