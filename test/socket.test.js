// Real-time tests: socket auth, room and private messages, typing, presence,
// rate limiting and resilience against malformed events.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, request, registerUser, connectSocket, emitAck, nextEvent } = require('./helpers');

let server;
const sockets = [];
before(async () => {
  server = await startServer(3902);
});
after(async () => {
  sockets.forEach((s) => s.close());
  await server?.stop();
});

async function connectedUser(prefix) {
  const user = await registerUser(server.base, prefix);
  const socket = await connectSocket(server.base, user.token);
  sockets.push(socket);
  return { ...user, socket };
}

async function generalRoomId(token) {
  const rooms = (await request(server.base, 'GET', '/api/rooms', { token })).body;
  return rooms.find((r) => r.name === 'General')._id;
}

describe('socket authentication', () => {
  test('rejects connections without a token', async () => {
    await assert.rejects(connectSocket(server.base, undefined), /Not authenticated/);
  });

  test('rejects an invalid token', async () => {
    await assert.rejects(connectSocket(server.base, 'not.a.jwt'), /Invalid or expired token/);
  });
});

describe('room messages', () => {
  test('are delivered to room members and saved to history', async () => {
    const alice = await connectedUser('alice');
    const bob = await connectedUser('bob');
    const roomId = await generalRoomId(alice.token);

    assert.deepEqual(await emitAck(alice.socket, 'join_room', roomId), { ok: true });
    assert.deepEqual(await emitAck(bob.socket, 'join_room', roomId), { ok: true });

    const received = nextEvent(bob.socket, 'room_message');
    assert.deepEqual(await emitAck(alice.socket, 'room_message', { roomId, text: '  hello room  ' }), { ok: true });

    const msg = await received;
    assert.equal(msg.text, 'hello room'); // trimmed
    assert.equal(msg.sender.username, alice.username);

    const history = await request(server.base, 'GET', `/api/messages/room/${roomId}`, { token: bob.token });
    assert.ok(history.body.some((m) => m._id === msg._id && m.text === 'hello room'));
  });

  test('cannot be sent to a room the user has not joined', async () => {
    const carol = await connectedUser('carol');
    const roomId = await generalRoomId(carol.token);
    const res = await emitAck(carol.socket, 'room_message', { roomId, text: 'hi' });
    assert.equal(res.error, 'Join the room first');
  });

  test('empty and over-long messages are rejected or trimmed', async () => {
    const dan = await connectedUser('dan');
    const roomId = await generalRoomId(dan.token);
    await emitAck(dan.socket, 'join_room', roomId);
    assert.equal((await emitAck(dan.socket, 'room_message', { roomId, text: '   ' })).error, 'Invalid message');

    const received = nextEvent(dan.socket, 'room_message');
    await emitAck(dan.socket, 'room_message', { roomId, text: 'x'.repeat(5000) });
    assert.equal((await received).text.length, 1000);
  });
});

describe('private messages', () => {
  test('reach the recipient and the sender only, and are saved', async () => {
    const erin = await connectedUser('erin');
    const frank = await connectedUser('frank');
    const outsider = await connectedUser('outsider');

    let leaked = false;
    outsider.socket.on('private_message', () => (leaked = true));

    const toFrank = nextEvent(frank.socket, 'private_message');
    const echo = nextEvent(erin.socket, 'private_message');
    const res = await emitAck(erin.socket, 'private_message', { to: frank.user._id, text: 'just for you' });
    assert.deepEqual(res, { ok: true });

    assert.equal((await toFrank).text, 'just for you');
    assert.equal((await echo).text, 'just for you');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(leaked, false, 'a third user must not receive the private message');

    const history = await request(server.base, 'GET', `/api/messages/dm/${erin.user._id}`, { token: frank.token });
    assert.equal(history.body.at(-1).text, 'just for you');
  });

  test('cannot be sent to yourself or to an unknown user', async () => {
    const gina = await connectedUser('gina');
    assert.equal((await emitAck(gina.socket, 'private_message', { to: gina.user._id, text: 'me' })).error, 'Invalid message');
    const res = await emitAck(gina.socket, 'private_message', { to: '5f0000000000000000000001', text: 'hi' });
    assert.equal(res.error, 'User not found');
  });
});

describe('typing and presence', () => {
  test('typing indicators are relayed to the other person', async () => {
    const hana = await connectedUser('hana');
    const ivan = await connectedUser('ivan');
    const typing = nextEvent(ivan.socket, 'typing');
    hana.socket.emit('typing', { to: ivan.user._id });
    const evt = await typing;
    assert.equal(evt.from, hana.user._id);
    assert.equal(evt.username, hana.username);
  });

  test('other users are told when someone comes online and goes offline', async () => {
    const watcher = await connectedUser('watcher');
    const user = await registerUser(server.base, 'joiner');

    const online = nextEvent(watcher.socket, 'user_online');
    const socket = await connectSocket(server.base, user.token);
    assert.equal((await online).userId, user.user._id);

    const offline = nextEvent(watcher.socket, 'user_offline');
    socket.close();
    assert.equal((await offline).userId, user.user._id);
  });
});

describe('abuse protection', () => {
  test('flooding messages is rate limited', async () => {
    const spam = await connectedUser('spam');
    const roomId = await generalRoomId(spam.token);
    await emitAck(spam.socket, 'join_room', roomId);
    const results = [];
    for (let i = 0; i < 12; i++) results.push(await emitAck(spam.socket, 'room_message', { roomId, text: `m${i}` }));
    assert.ok(results.some((r) => r.error === 'You are sending messages too fast'));
  });

  test('malformed events do not crash the server', async () => {
    const mal = await connectedUser('mal');
    assert.ok((await emitAck(mal.socket, 'room_message', null)).error);
    assert.ok((await emitAck(mal.socket, 'private_message', null)).error);
    assert.ok((await emitAck(mal.socket, 'join_room', { $ne: 1 })).error);
    mal.socket.emit('typing', null);
    mal.socket.emit('stop_typing', 'nonsense');
    await new Promise((r) => setTimeout(r, 300));

    const health = await request(server.base, 'GET', '/api/health');
    assert.equal(health.status, 200, `server crashed:\n${server.output()}`);
  });
});
