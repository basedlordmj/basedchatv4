const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { assertParticipant } = require('../controllers/conversationsController');

function initSockets(io) {
  // Authenticate the socket using the same JWT the REST API uses.
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Missing auth token'));
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET); // { id, publicId, handle }
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', async (socket) => {
    // Auto-join every conversation this user is part of, so messages route without extra calls.
    const rows = await query(
      'SELECT conversation_id FROM conversation_participants WHERE user_id = $1',
      [socket.user.id]
    );
    rows.rows.forEach((r) => socket.join(`conversation:${r.conversation_id}`));

    socket.on('typing', ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit('typing', {
        conversationId,
        user: { id: socket.user.publicId, handle: socket.user.handle },
      });
    });

    // Optional: send a message over the socket instead of REST.
    socket.on('message:send', async ({ conversationId, body }, ack) => {
      try {
        if (!body || !body.trim()) throw new Error('Empty message');
        if (!(await assertParticipant(conversationId, socket.user.id))) {
          throw new Error('Not a participant');
        }
        const result = await query(
          'INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3) RETURNING *',
          [conversationId, socket.user.id, body.trim().slice(0, 2000)]
        );
        const message = {
          id: result.rows[0].id,
          body: result.rows[0].body,
          createdAt: result.rows[0].created_at,
          conversationId,
          sender: { id: socket.user.publicId, handle: socket.user.handle },
        };
        io.to(`conversation:${conversationId}`).emit('message:new', message);
        if (ack) ack({ ok: true, message });
      } catch (err) {
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    // Join a brand-new conversation's room right after creating it (REST returns the id).
    socket.on('conversation:join', ({ conversationId }) => {
      socket.join(`conversation:${conversationId}`);
    });
  });
}

module.exports = { initSockets };
