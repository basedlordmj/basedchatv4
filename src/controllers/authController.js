const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { levelForXp } = require('../utils/xp');

const HANDLE_RE = /^[a-z0-9_]{2,20}$/i;

function toPublicUser(row) {
  return {
    id: row.public_id,
    handle: row.handle,
    avatarLetter: row.avatar_letter,
    xp: row.xp,
    level: row.level,
    levelLabel: levelForXp(row.xp).label,
    createdAt: row.created_at,
  };
}

function signToken(row) {
  return jwt.sign(
    { id: row.id, publicId: row.public_id, handle: row.handle },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

async function register(req, res) {
  const { handle, email, password } = req.body;

  if (!handle || !HANDLE_RE.test(handle)) {
    return res.status(400).json({ error: '2-20 letters, numbers, or underscores.' });
  }
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required.' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const normalizedHandle = handle.toLowerCase();
  const passwordHash = await bcrypt.hash(password, 10);
  const avatarLetter = normalizedHandle[0].toUpperCase();

  try {
    const result = await query(
      `INSERT INTO users (handle, email, password_hash, avatar_letter)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [normalizedHandle, email.toLowerCase(), passwordHash, avatarLetter]
    );
    const user = result.rows[0];
    const token = signToken(user);
    res.status(201).json({ token, user: toPublicUser(user) });
  } catch (err) {
    if (err.code === '23505') {
      const field = err.constraint && err.constraint.includes('handle') ? 'handle' : 'email';
      return res.status(409).json({ error: `That ${field} is already taken.` });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not create account.' });
  }
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

  const result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password.' });

  const token = signToken(user);
  res.json({ token, user: toPublicUser(user) });
}

async function me(req, res) {
  const result = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: toPublicUser(result.rows[0]) });
}

module.exports = { register, login, me, toPublicUser };
