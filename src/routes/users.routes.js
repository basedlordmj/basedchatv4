const router = require('express').Router();
const { getProfile, search, leaderboard } = require('../controllers/usersController');

router.get('/leaderboard', leaderboard);
router.get('/', search); // GET /api/users?q=...
router.get('/:handleOrId', getProfile);

module.exports = router;
