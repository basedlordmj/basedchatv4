const path = require('path');

// Anchor everything to the actual project root (two levels up from src/config/),
// regardless of what directory the process was launched from (systemd, pm2,
// a CI runner, etc. don't always match `process.cwd()` to your repo root).
const ROOT = path.join(__dirname, '..', '..');
const UPLOAD_DIR = path.join(ROOT, process.env.UPLOAD_DIR || 'uploads');
const PUBLIC_DIR = path.join(ROOT, 'public');

module.exports = { ROOT, UPLOAD_DIR, PUBLIC_DIR };
