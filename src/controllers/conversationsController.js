const path = require('path');
const { pool, query } = require('../config/db');

async function assertParticipant(conversationId, userId) {
  const res = await query(
    'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
    [conversationId, userId]
  );
  return res.rows.length > 0;
}

// GET /api/conversations — list mine, most recently active first
async function listMine(req, res) {
  const result = await query(
    `SELECT c.*,
       (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
       (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_at
     FROM conversations c
     JOIN conversation_participants cp ON cp.conversation_id = c.id
     WHERE cp.user_id = $1
     ORDER BY last_at DESC NULLS LAST, c.created_at DESC`,
    [req.user.id]
  );

  const conversations = await Promise.all(
    result.rows.map(async (c) => {
      const members = await query(
        `SELECT u.public_id, u.handle, u.avatar_letter FROM conversation_participants cp
         JOIN users u ON u.id = cp.user_id WHERE cp.conversation_id = $1`,
        [c.id]
      );
      return {
        id: c.id,
        isGroup: c.is_group,
        name: c.name,
        backgroundUrl: c.background_url,
        lastMessage: c.last_body,
        lastAt: c.last_at,
        members: members.rows.map((m) => ({
          id: m.public_id,
          handle: m.handle,
          avatarLetter: m.avatar_letter,
        })),
      };
    })
  );

  res.json({ conversations });
}

// POST /api/conversations  { handles: ["alice","bob"], isGroup: bool, name?: string }
async function create(req, res) {
  const { handles, isGroup, name } = req.body;
  if (!Array.isArray(handles) || handles.length === 0) {
    return res.status(400).json({ error: 'At least one other handle is required.' });
  }

  const members = await query('SELECT id FROM users WHERE handle = ANY($1)', [
    handles.map((h) => String(h).toLowerCase()),
  ]);
  if (members.rows.length !== handles.length) {
    return res.status(404).json({ error: 'One or more handles were not found.' });
  }
  const memberIds = [...new Set([req.user.id, ...members.rows.map((r) => r.id)])];
  const group = !!isGroup || memberIds.length > 2;

  if (group && !name) return res.status(400).json({ error: 'Groupchats need a name.' });

  // For 1:1 DMs, reuse an existing conversation between the same two people instead of duplicating.
  if (!group) {
    const existing = await query(
      `SELECT c.id FROM conversations c
       WHERE c.is_group = false
       AND (SELECT COUNT(*) FROM conversation_participants cp WHERE cp.conversation_id = c.id) = 2
       AND EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = $1)
       AND EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = $2)`,
      [memberIds[0], memberIds[1]]
    );
    if (existing.rows[0]) return res.json({ conversationId: existing.rows[0].id, reused: true });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const conv = await client.query(
      'INSERT INTO conversations (is_group, name, created_by) VALUES ($1, $2, $3) RETURNING id',
      [group, group ? name : null, req.user.id]
    );
    for (const uid of memberIds) {
      await client.query(
        'INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2)',
        [conv.rows[0].id, uid]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ conversationId: conv.rows[0].id, reused: false });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not create conversation.' });
  } finally {
    client.release();
  }
}

// GET /api/conversations/:id/messages?before=<messageId>&limit=
async function getMessages(req, res) {
  const conversationId = Number(req.params.id);
  if (!(await assertParticipant(conversationId, req.user.id))) {
    return res.status(403).json({ error: 'Not a participant in this conversation.' });
  }

  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const before = req.query.before ? Number(req.query.before) : null;

  const rows = before
    ? (
        await query(
          `SELECT m.*, u.public_id, u.handle, u.avatar_letter FROM messages m
           JOIN users u ON u.id = m.sender_id
           WHERE m.conversation_id = $1 AND m.id < $2
           ORDER BY m.id DESC LIMIT $3`,
          [conversationId, before, limit]
        )
      ).rows
    : (
        await query(
          `SELECT m.*, u.public_id, u.handle, u.avatar_letter FROM messages m
           JOIN users u ON u.id = m.sender_id
           WHERE m.conversation_id = $1
           ORDER BY m.id DESC LIMIT $2`,
          [conversationId, limit]
        )
      ).rows;

  await query(
    'UPDATE conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2',
    [conversationId, req.user.id]
  );

  res.json({
    messages: rows.reverse().map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.created_at,
      sender: { id: r.public_id, handle: r.handle, avatarLetter: r.avatar_letter },
    })),
  });
}

// POST /api/conversations/:id/messages  { body }  — also broadcast over the socket, see src/sockets
async function postMessage(req, res) {
  const conversationId = Number(req.params.id);
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'Message body required.' });
  if (!(await assertParticipant(conversationId, req.user.id))) {
    return res.status(403).json({ error: 'Not a participant in this conversation.' });
  }

  const result = await query(
    'INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3) RETURNING *',
    [conversationId, req.user.id, body.trim().slice(0, 2000)]
  );
  const message = {
    id: result.rows[0].id,
    body: result.rows[0].body,
    createdAt: result.rows[0].created_at,
    conversationId,
    sender: { id: req.user.publicId, handle: req.user.handle },
  };

  const io = req.app.get('io');
  if (io) io.to(`conversation:${conversationId}`).emit('message:new', message);

  res.status(201).json({ message });
}

// POST /api/conversations/:id/background (multipart image) — groupchats only
async function setBackground(req, res) {
  const conversationId = Number(req.params.id);
  if (!(await assertParticipant(conversationId, req.user.id))) {
    return res.status(403).json({ error: 'Not a participant in this conversation.' });
  }
  if (!req.file) return res.status(400).json({ error: 'An image file is required.' });

  const url = `/uploads/backgrounds/${path.basename(req.file.path)}`;
  await query('UPDATE conversations SET background_url = $1 WHERE id = $2', [url, conversationId]);
  res.json({ backgroundUrl: url });
}

module.exports = { listMine, create, getMessages, postMessage, setBackground, assertParticipant };
