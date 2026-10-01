const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Room = require('../models/Room');
const Message = require('../models/Message');
const { requireAuth } = require('../middleware/auth');
const presence = require('../socket/presence');

const router = express.Router();
router.use(requireAuth); // every route below needs a valid JWT

const isId = (id) => mongoose.Types.ObjectId.isValid(id);
const PAGE_SIZE = 50;

// GET /api/users -> everyone except me, with online flag
router.get('/users', async (req, res, next) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.id } }).sort({ username: 1 });
    res.json(
      users.map((u) => ({ ...u.toJSON(), online: presence.isOnline(u._id.toString()) }))
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/rooms -> all group rooms
router.get('/rooms', async (req, res, next) => {
  try {
    const rooms = await Room.find().sort({ createdAt: 1 }).select('-__v');
    res.json(rooms);
  } catch (err) {
    next(err);
  }
});

// POST /api/rooms { name, description } -> create a group room
router.post('/rooms', async (req, res, next) => {
  try {
    const name = (req.body?.name || '').trim();
    const description = (req.body?.description || '').trim();
    if (name.length < 2 || name.length > 30) {
      return res.status(400).json({ error: 'Room name must be 2-30 characters' });
    }
    const exists = await Room.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, 'i') });
    if (exists) return res.status(409).json({ error: 'A room with that name already exists' });

    const room = await Room.create({
      name,
      description,
      createdBy: req.user.id,
      members: [req.user.id],
    });

    // Tell every connected client a new room exists
    req.app.get('io').emit('room_created', room);
    res.status(201).json(room);
  } catch (err) {
    next(err);
  }
});

// GET /api/messages/room/:roomId?before=<ISO date>
router.get('/messages/room/:roomId', async (req, res, next) => {
  try {
    const { roomId } = req.params;
    if (!isId(roomId)) return res.status(400).json({ error: 'Invalid room id' });

    const query = { room: roomId };
    const before = parseBefore(req.query.before);
    if (before === false) return res.status(400).json({ error: 'Invalid "before" date' });
    if (before) query.createdAt = { $lt: before };

    const msgs = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(PAGE_SIZE)
      .populate('sender', 'username');
    res.json(msgs.reverse()); // oldest first for display
  } catch (err) {
    next(err);
  }
});

// GET /api/messages/dm/:userId?before=<ISO date>  -> conversation between me and userId
router.get('/messages/dm/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!isId(userId)) return res.status(400).json({ error: 'Invalid user id' });

    const query = {
      $or: [
        { sender: req.user.id, recipient: userId },
        { sender: userId, recipient: req.user.id },
      ],
    };
    const before = parseBefore(req.query.before);
    if (before === false) return res.status(400).json({ error: 'Invalid "before" date' });
    if (before) query.createdAt = { $lt: before };

    const msgs = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(PAGE_SIZE)
      .populate('sender', 'username');
    res.json(msgs.reverse());
  } catch (err) {
    next(err);
  }
});

// ?before=<ISO date> for paging back through history.
// Returns null when absent, false when present but not a valid date.
function parseBefore(value) {
  if (value === undefined) return null;
  const date = typeof value === 'string' ? new Date(value) : new Date(NaN);
  return Number.isNaN(date.getTime()) ? false : date;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = router;
