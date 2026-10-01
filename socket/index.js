const mongoose = require('mongoose');
const { verifyToken } = require('../middleware/auth');
const presence = require('./presence');
const User = require('../models/User');
const Room = require('../models/Room');
const Message = require('../models/Message');

const isId = (id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id);
const roomChannel = (roomId) => `room:${roomId}`;
const userChannel = (userId) => `user:${userId}`;

// Simple flood protection: max 10 messages per 5 seconds per socket
function makeRateLimiter(limit = 10, windowMs = 5000) {
  let stamps = [];
  return () => {
    const now = Date.now();
    stamps = stamps.filter((t) => now - t < windowMs);
    if (stamps.length >= limit) return false;
    stamps.push(now);
    return true;
  };
}

// Wrap a socket event handler so a malformed payload (e.g. null instead of an
// object) or a database error is reported back to the client instead of
// becoming an uncaught exception that would crash the whole server.
function safe(event, handler) {
  return async (...args) => {
    const last = args[args.length - 1];
    const ack = typeof last === 'function' ? last : null;
    try {
      await handler(...args.map((a) => (a === null ? undefined : a)));
    } catch (err) {
      console.error(`socket "${event}" error:`, err.message);
      ack?.({ error: 'Something went wrong' });
    }
  };
}

// Only call the acknowledgement if the client actually sent a callback
const reply = (ack, data) => typeof ack === 'function' && ack(data);

function cleanText(text) {
  if (typeof text !== 'string') return '';
  return text.trim().slice(0, 1000);
}

module.exports = function registerSocket(io) {
  // 1) Authenticate every socket connection with the JWT before it connects
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Not authenticated'));
    try {
      socket.user = verifyToken(token); // { id, username }
    } catch {
      return next(new Error('Invalid or expired token'));
    }
    try {
      // A valid token can outlive its user (e.g. database was reset) -> force a fresh login
      if (!isId(socket.user.id) || !(await User.exists({ _id: socket.user.id }))) {
        return next(new Error('Not authenticated'));
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on('connection', (socket) => {
    const on = (event, handler) => socket.on(event, safe(event, handler));
    const { id: userId, username } = socket.user;
    const allowMessage = makeRateLimiter();

    // Personal channel: private messages to this user are sent here
    socket.join(userChannel(userId));

    // 2) Online status
    const cameOnline = presence.addConnection(userId, socket.id);
    if (cameOnline) socket.broadcast.emit('user_online', { userId, username });
    socket.emit('online_users', presence.onlineUserIds());

    // 3) Rooms
    on('join_room', async (roomId, ack) => {
      if (!isId(roomId)) return reply(ack, { error: 'Invalid room id' });
      const room = await Room.findByIdAndUpdate(
        roomId,
        { $addToSet: { members: userId } },
        { new: true }
      );
      if (!room) return reply(ack, { error: 'Room not found' });
      socket.join(roomChannel(roomId));
      reply(ack, { ok: true });
    });

    on('leave_room', (roomId) => {
      if (isId(roomId)) socket.leave(roomChannel(roomId));
    });

    // 4) Group message -> save to MongoDB, then broadcast to the room
    on('room_message', async ({ roomId, text } = {}, ack) => {
      try {
        if (!allowMessage()) return reply(ack, { error: 'You are sending messages too fast' });
        text = cleanText(text);
        if (!isId(roomId) || !text) return reply(ack, { error: 'Invalid message' });
        if (!socket.rooms.has(roomChannel(roomId))) return reply(ack, { error: 'Join the room first' });

        const msg = await Message.create({ sender: userId, room: roomId, text });
        const payload = {
          _id: msg._id,
          room: roomId,
          text: msg.text,
          createdAt: msg.createdAt,
          sender: { _id: userId, username },
        };
        io.to(roomChannel(roomId)).emit('room_message', payload);
        reply(ack, { ok: true });
      } catch (err) {
        console.error('room_message error:', err.message);
        reply(ack, { error: 'Could not send message' });
      }
    });

    // 5) Private message -> save, then send to both users' personal channels
    //    (so the sender's other open tabs also see it)
    on('private_message', async ({ to, text } = {}, ack) => {
      try {
        if (!allowMessage()) return reply(ack, { error: 'You are sending messages too fast' });
        text = cleanText(text);
        if (!isId(to) || !text || to === userId) return reply(ack, { error: 'Invalid message' });
        if (!(await User.exists({ _id: to }))) return reply(ack, { error: 'User not found' });

        const msg = await Message.create({ sender: userId, recipient: to, text });
        const payload = {
          _id: msg._id,
          recipient: to,
          text: msg.text,
          createdAt: msg.createdAt,
          sender: { _id: userId, username },
        };
        io.to(userChannel(to)).to(userChannel(userId)).emit('private_message', payload);
        reply(ack, { ok: true });
      } catch (err) {
        console.error('private_message error:', err.message);
        reply(ack, { error: 'Could not send message' });
      }
    });

    // 6) Typing indicators (not stored, just relayed)
    on('typing', ({ roomId, to } = {}) => {
      if (isId(roomId)) socket.to(roomChannel(roomId)).emit('typing', { roomId, userId, username });
      else if (isId(to)) socket.to(userChannel(to)).emit('typing', { from: userId, username });
    });

    on('stop_typing', ({ roomId, to } = {}) => {
      if (isId(roomId)) socket.to(roomChannel(roomId)).emit('stop_typing', { roomId, userId });
      else if (isId(to)) socket.to(userChannel(to)).emit('stop_typing', { from: userId });
    });

    // 7) Disconnect -> update presence and last seen
    on('disconnect', async () => {
      const wentOffline = presence.removeConnection(userId, socket.id);
      if (wentOffline) {
        const lastSeen = new Date();
        await User.findByIdAndUpdate(userId, { lastSeen }).catch(() => {});
        io.emit('user_offline', { userId, lastSeen });
      }
    });
  });
};
