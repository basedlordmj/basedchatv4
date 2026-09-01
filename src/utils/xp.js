// Mirrors the level ladder shown in the frontend's .level-card
const LEVELS = [
  { level: 1, label: 'rook', xp: 0 },
  { level: 2, label: 'uploader', xp: 250 },
  { level: 3, label: 'regular', xp: 500 },
  { level: 4, label: 'cool mf', xp: 1000 },
  { level: 5, label: 'rising star', xp: 2000 },
  { level: 6, label: 'verified', xp: 4000 },
  { level: 7, label: 'swag', xp: 8000 },
  { level: 8, label: 'elite', xp: 16000 },
  { level: 9, label: 'based', xp: 32000 },
  { level: 10, label: 'based god', xp: 64000 },
];

// XP legend from the feed header: like +50xp · comment +150xp · repost +450xp
const XP_AWARDS = {
  like: 50,
  comment: 150,
  repost: 450,
};

function levelForXp(xp) {
  let current = LEVELS[0];
  for (const l of LEVELS) {
    if (xp >= l.xp) current = l;
    else break;
  }
  return current;
}

function nextLevel(xp) {
  return LEVELS.find((l) => l.xp > xp) || null;
}

module.exports = { LEVELS, XP_AWARDS, levelForXp, nextLevel };
