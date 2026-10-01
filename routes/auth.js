const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { signToken, requireAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

const router = express.Router();

// Brute-force protection: 10 failed login/register attempts per IP every 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT) || 10,
  message: 'Too many failed attempts. Please wait a few minutes and try again.',
  skipSuccessful: true,
});

// Usernames are unique regardless of case ("Meera" and "meera" are the same person),
// so sign-up and login both compare case-insensitively.
const CASE_INSENSITIVE = { locale: 'en', strength: 2 };

// Only accept plain strings. Objects like { "$ne": null } would otherwise reach
// MongoDB as query operators (NoSQL injection) or crash bcrypt.
function readCredentials(body) {
  const { username, password } = body || {};
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  if (!username.trim() || !password) return null;
  if (password.length > 128) return null; // bcrypt only uses 72 bytes; cap work per request
  return { username: username.trim(), password };
}

// POST /api/auth/register  { username, password }
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const creds = readCredentials(req.body);
    if (!creds) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const { username, password } = creds;
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-20 letters, numbers or _' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const exists = await User.findOne({ username }).collation(CASE_INSENSITIVE);
    if (exists) return res.status(409).json({ error: 'Username already taken' });

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hash });

    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login  { username, password }
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const creds = readCredentials(req.body);
    if (!creds) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const { username, password } = creds;

    const user = await User.findOne({ username }).collation(CASE_INSENSITIVE);
    // Same message for both cases so attackers can't tell which usernames exist
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    res.json({ token: signToken(user), user });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me  -> current user (used to validate a saved token)
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
