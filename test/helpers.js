// Test helpers: start the real server (server.js) as a child process with a
// throwaway in-memory MongoDB, and small utilities for calling it.
const { spawn } = require('node:child_process');
const path = require('node:path');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');

// Starts the server and resolves once it is listening. env overrides .env values.
function startServer(port, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        MONGO_URI: '', // empty -> server uses a temporary in-memory MongoDB
        JWT_SECRET: 'test_secret_for_automated_tests_only',
        AUTH_RATE_LIMIT: '1000',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Server did not start within 60s:\n${output}`));
    }, 60000);

    const onData = (chunk) => {
      output += chunk;
      if (output.includes('Chat app running')) {
        clearTimeout(timer);
        resolve({
          base: `http://localhost:${port}`,
          stop: () => new Promise((done) => {
            child.once('exit', done);
            child.kill();
          }),
          output: () => output,
        });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => (output += chunk));
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early (code ${code}):\n${output}`));
    });
  });
}

// JSON request helper -> { status, body }
async function request(base, method, route, { token, body } = {}) {
  const res = await fetch(base + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, headers: res.headers };
}

let counter = 0;
// Registers a fresh user with a unique name -> { token, user, username, password }
async function registerUser(base, prefix = 'user') {
  const username = `${prefix}${Date.now().toString(36)}${counter++}`.slice(0, 20);
  const password = 'secret123';
  const res = await request(base, 'POST', '/api/auth/register', { body: { username, password } });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, username, password };
}

// Opens an authenticated socket and waits until it is connected (or rejected)
function connectSocket(base, token) {
  return new Promise((resolve, reject) => {
    const socket = io(base, { auth: { token }, transports: ['websocket'], reconnection: false });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => {
      socket.close();
      reject(err);
    });
  });
}

// Emits an event and resolves with the server's acknowledgement
function emitAck(socket, event, payload) {
  return socket.timeout(3000).emitWithAck(event, payload);
}

// Resolves with the next payload of `event`, or rejects after `ms`
function nextEvent(socket, event, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, ms);
    function handler(data) {
      clearTimeout(timer);
      resolve(data);
    }
    socket.once(event, handler);
  });
}

module.exports = { startServer, request, registerUser, connectSocket, emitAck, nextEvent };
