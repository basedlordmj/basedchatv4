const { query } = require('../config/db');
const { levelForXp, nextLevel } = require('../utils/xp');

function shapeUser(row) {
  const lvl = levelForXp(row.xp);
  const nxt = nextLevel(row.xp);
  return {
    id: row.public_id,
    handle: row.handle,
    avatarLetter: row.avatar_letter,
    xp: row.xp,
    level: lvl.level,
    levelLabel: lvl.label,
    xpToNextLevel: nxt ? nxt.xp - row.xp : 0,
    nextLevelLabel: nxt ? nxt.label : null,
    createdAt: row.created_at,
  };
}

// GET /api/users/:handleOrId  — lookup by @handle or #publicId
async function getProfile(req, res) {
  const { handleOrId } = req.params;
  const isId = /^\d+$/.test(handleOrId);
  const result = await query(
    isId ? 'SELECT * FROM users WHERE public_id = $1' : 'SELECT * FROM users WHERE handle = $1',
    [isId ? Number(handleOrId) : handleOrId.toLowerCase()]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found.' });

  const videoCount = await query('SELECT COUNT(*)::int AS n FROM videos WHERE user_id = $1', [
    result.rows[0].id,
  ]);

  res.json({ user: { ...shapeUser(result.rows[0]), videoCount: videoCount.rows[0].n } });
}

// GET /api/users?q=search
async function search(req, res) {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ users: [] });

  const result = await query(
    `SELECT * FROM users
     WHERE handle ILIKE $1 OR public_id::text = $2
     ORDER BY xp DESC LIMIT 20`,
    [`%${q}%`, q]
  );
  res.json({ users: result.rows.map(shapeUser) });
}

// GET /api/leaderboard?sort=xp|posts
async function leaderboard(req, res) {
  const sort = req.query.sort === 'posts' ? 'posts' : 'xp';

  const sql =
    sort === 'posts'
      ? `SELECT u.*, COUNT(v.id)::int AS post_count
         FROM users u LEFT JOIN videos v ON v.user_id = u.id
         GROUP BY u.id ORDER BY post_count DESC, u.xp DESC LIMIT 50`
      : `SELECT u.*, COUNT(v.id)::int AS post_count
         FROM users u LEFT JOIN videos v ON v.user_id = u.id
         GROUP BY u.id ORDER BY u.xp DESC LIMIT 50`;

  const result = await query(sql);
  res.json({
    sort,
    users: result.rows.map((r) => ({ ...shapeUser(r), postCount: r.post_count })),
  });
}

module.exports = { getProfile, search, leaderboard, shapeUser };
