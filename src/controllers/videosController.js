const path = require('path');
const { pool, query } = require('../config/db');
const { XP_AWARDS, levelForXp } = require('../utils/xp');
const { shapeUser } = require('./usersController');

function shapeVideo(row, viewerLiked, viewerReposted) {
  return {
    id: row.id,
    caption: row.caption,
    url: `/uploads/videos/${path.basename(row.file_path)}`,
    trackLabel: row.track_label,
    durationSeconds: row.duration_seconds,
    createdAt: row.created_at,
    author: {
      id: row.public_id,
      handle: row.handle,
      avatarLetter: row.avatar_letter,
      level: levelForXp(row.xp).level,
    },
    likeCount: row.like_count,
    commentCount: row.comment_count,
    repostCount: row.repost_count,
    likedByMe: !!viewerLiked,
    repostedByMe: !!viewerReposted,
  };
}

const FEED_BASE_SQL = `
  SELECT v.*, u.public_id, u.handle, u.avatar_letter, u.xp,
    (SELECT COUNT(*)::int FROM likes l WHERE l.video_id = v.id) AS like_count,
    (SELECT COUNT(*)::int FROM comments c WHERE c.video_id = v.id) AS comment_count,
    (SELECT COUNT(*)::int FROM reposts r WHERE r.video_id = v.id) AS repost_count
  FROM videos v
  JOIN users u ON u.id = v.user_id
`;

// GET /api/videos?cursor=&limit=
async function getFeed(req, res) {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const cursor = req.query.cursor ? Number(req.query.cursor) : null;

  const rows = cursor
    ? (await query(`${FEED_BASE_SQL} WHERE v.id < $1 ORDER BY v.id DESC LIMIT $2`, [cursor, limit])).rows
    : (await query(`${FEED_BASE_SQL} ORDER BY v.id DESC LIMIT $1`, [limit])).rows;

  let liked = new Set();
  let reposted = new Set();
  if (req.user && rows.length) {
    const ids = rows.map((r) => r.id);
    const likeRows = await query(
      'SELECT video_id FROM likes WHERE user_id = $1 AND video_id = ANY($2)',
      [req.user.id, ids]
    );
    const repostRows = await query(
      'SELECT video_id FROM reposts WHERE user_id = $1 AND video_id = ANY($2)',
      [req.user.id, ids]
    );
    liked = new Set(likeRows.rows.map((r) => r.video_id));
    reposted = new Set(repostRows.rows.map((r) => r.video_id));
  }

  const videos = rows.map((r) => shapeVideo(r, liked.has(r.id), reposted.has(r.id)));
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;
  res.json({ videos, nextCursor });
}

// GET /api/videos/:id
async function getOne(req, res) {
  const result = await query(`${FEED_BASE_SQL} WHERE v.id = $1`, [req.params.id]);
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'Video not found.' });

  let liked = false;
  let reposted = false;
  if (req.user) {
    const l = await query('SELECT 1 FROM likes WHERE video_id = $1 AND user_id = $2', [row.id, req.user.id]);
    const r = await query('SELECT 1 FROM reposts WHERE video_id = $1 AND user_id = $2', [row.id, req.user.id]);
    liked = l.rows.length > 0;
    reposted = r.rows.length > 0;
  }
  res.json({ video: shapeVideo(row, liked, reposted) });
}

// POST /api/videos (multipart: video file, caption, trackLabel)
async function upload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'A video file is required.' });
  const { caption, trackLabel, durationSeconds } = req.body;

  const result = await query(
    `INSERT INTO videos (user_id, caption, file_path, track_label, duration_seconds)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [req.user.id, caption || null, req.file.path, trackLabel || 'original audio', durationSeconds || null]
  );

  const full = await query(`${FEED_BASE_SQL} WHERE v.id = $1`, [result.rows[0].id]);
  res.status(201).json({ video: shapeVideo(full.rows[0], false, false) });
}

// Awards XP to a video's author, inside a transaction, and returns their new totals.
async function awardXp(client, videoId, reason) {
  const amount = XP_AWARDS[reason];
  const videoRes = await client.query('SELECT user_id FROM videos WHERE id = $1 FOR UPDATE', [videoId]);
  if (!videoRes.rows[0]) throw new Error('VIDEO_NOT_FOUND');
  const authorId = videoRes.rows[0].user_id;

  await client.query('UPDATE users SET xp = xp + $1 WHERE id = $2', [amount, authorId]);
  await client.query(
    'INSERT INTO xp_events (user_id, amount, reason, video_id) VALUES ($1, $2, $3, $4)',
    [authorId, amount, reason, videoId]
  );

  const updated = await client.query('SELECT * FROM users WHERE id = $1', [authorId]);
  return shapeUser(updated.rows[0]);
}

// POST /api/videos/:id/like  (toggle)
async function toggleLike(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT 1 FROM likes WHERE video_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    let liked;
    let author = null;
    if (existing.rows.length) {
      await client.query('DELETE FROM likes WHERE video_id = $1 AND user_id = $2', [
        req.params.id,
        req.user.id,
      ]);
      liked = false;
      // Note: XP already awarded is intentionally not clawed back on unlike.
    } else {
      await client.query('INSERT INTO likes (video_id, user_id) VALUES ($1, $2)', [
        req.params.id,
        req.user.id,
      ]);
      author = await awardXp(client, req.params.id, 'like');
      liked = true;
    }

    await client.query('COMMIT');
    const countRes = await query('SELECT COUNT(*)::int AS n FROM likes WHERE video_id = $1', [req.params.id]);
    res.json({ liked, likeCount: countRes.rows[0].n, author });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message === 'VIDEO_NOT_FOUND') return res.status(404).json({ error: 'Video not found.' });
    console.error(err);
    res.status(500).json({ error: 'Could not toggle like.' });
  } finally {
    client.release();
  }
}

// POST /api/videos/:id/repost (toggle)
async function toggleRepost(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT 1 FROM reposts WHERE video_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    let reposted;
    let author = null;
    if (existing.rows.length) {
      await client.query('DELETE FROM reposts WHERE video_id = $1 AND user_id = $2', [
        req.params.id,
        req.user.id,
      ]);
      reposted = false;
    } else {
      await client.query('INSERT INTO reposts (video_id, user_id) VALUES ($1, $2)', [
        req.params.id,
        req.user.id,
      ]);
      author = await awardXp(client, req.params.id, 'repost');
      reposted = true;
    }

    await client.query('COMMIT');
    const countRes = await query('SELECT COUNT(*)::int AS n FROM reposts WHERE video_id = $1', [req.params.id]);
    res.json({ reposted, repostCount: countRes.rows[0].n, author });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message === 'VIDEO_NOT_FOUND') return res.status(404).json({ error: 'Video not found.' });
    console.error(err);
    res.status(500).json({ error: 'Could not toggle repost.' });
  } finally {
    client.release();
  }
}

// GET /api/videos/:id/comments
async function getComments(req, res) {
  const result = await query(
    `SELECT c.*, u.public_id, u.handle, u.avatar_letter
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.video_id = $1 ORDER BY c.created_at ASC`,
    [req.params.id]
  );
  res.json({
    comments: result.rows.map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.created_at,
      author: { id: r.public_id, handle: r.handle, avatarLetter: r.avatar_letter },
    })),
  });
}

// POST /api/videos/:id/comments  { body }
async function addComment(req, res) {
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'Comment body required.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      'INSERT INTO comments (video_id, user_id, body) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, req.user.id, body.trim().slice(0, 1000)]
    );
    const author = await awardXp(client, req.params.id, 'comment');
    await client.query('COMMIT');

    res.status(201).json({
      comment: {
        id: inserted.rows[0].id,
        body: inserted.rows[0].body,
        createdAt: inserted.rows[0].created_at,
      },
      videoAuthor: author,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message === 'VIDEO_NOT_FOUND') return res.status(404).json({ error: 'Video not found.' });
    console.error(err);
    res.status(500).json({ error: 'Could not add comment.' });
  } finally {
    client.release();
  }
}

module.exports = { getFeed, getOne, upload, toggleLike, toggleRepost, getComments, addComment };
