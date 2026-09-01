require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { Server } = require('socket.io');

const { UPLOAD_DIR, PUBLIC_DIR } = require('./config/paths');
const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const videosRoutes = require('./routes/videos.routes');
const conversationsRoutes = require('./routes/conversations.routes');
const { initSockets } = require('./sockets');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN || '*' },
});

app.set('io', io);

// Behind a reverse proxy (nginx, a PaaS load balancer, etc) in production —
// needed for req.ip / rate limiting to see the real client IP instead of the proxy's.
app.set('trust proxy', 1);

app.use(helmet({
  // Videos are served cross-origin to <video> tags; a strict default CORP header blocks that.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

// Serves the wired basedchat.html frontend directly from this backend, so
// visiting this server's URL always opens a working copy pointed at itself —
// no separate frontend server or CORS setup needed.
app.use(express.static(PUBLIC_DIR));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'basedchat.html')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Basic abuse protection on the endpoints most worth throttling in production.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/videos', writeLimiter, videosRoutes);
app.use('/api/conversations', writeLimiter, conversationsRoutes);

// Multer / generic error handler — keeps upload errors as clean JSON instead of a stack trace.
app.use((err, req, res, next) => {
  if (err) {
    console.error(err);
    return res.status(400).json({ error: err.message || 'Something went wrong.' });
  }
  next();
});

initSockets(io);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`basedchat backend listening on http://localhost:${PORT}`);
});
