require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const registerSocket = require('./socket');
const Room = require('./models/Room');

const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  console.warn('⚠  JWT_SECRET not set — using an insecure development secret. Set it in .env!');
  process.env.JWT_SECRET = 'dev_only_insecure_secret';
}

async function connectDatabase() {
  let uri = process.env.MONGO_URI;

  if (!uri) {
    // No database configured -> start a temporary in-memory MongoDB for quick demos
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const mem = await MongoMemoryServer.create();
    uri = mem.getUri('chatapp');
    console.log('ℹ  MONGO_URI not set — using in-memory MongoDB (data resets on restart)');
  }

  await mongoose.connect(uri);
  console.log('✔  MongoDB connected');

  // Make sure there is always at least one room to chat in
  const count = await Room.countDocuments();
  if (count === 0) {
    await Room.create({ name: 'General', description: 'Chat with everyone' });
    await Room.create({ name: 'Random', description: 'Off-topic talk' });
    console.log('✔  Created default rooms: General, Random');
  }
}

async function start() {
  await connectDatabase();

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  app.set('io', io); // so REST routes can emit socket events

  // Basic security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use(express.json({ limit: '10kb' }));
  // no-cache: browsers must revalidate, so they never run a stale copy of the client JS
  app.use(
    express.static(path.join(__dirname, 'public'), {
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
    })
  );

  // Public health check — must come before chatRoutes, which requires auth for all of /api
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRoutes);
  app.use('/api', chatRoutes);

  // Unknown API route
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Central error handler
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  registerSocket(io);

  server.listen(PORT, () => {
    console.log(`🚀  Chat app running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
