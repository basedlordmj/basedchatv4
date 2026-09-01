const router = require('express').Router();
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { videoUpload } = require('../middleware/upload');
const {
  getFeed,
  getOne,
  upload,
  toggleLike,
  toggleRepost,
  getComments,
  addComment,
} = require('../controllers/videosController');

router.get('/', optionalAuth, getFeed);
router.get('/:id', optionalAuth, getOne);
router.post('/', requireAuth, videoUpload.single('video'), upload);

router.post('/:id/like', requireAuth, toggleLike);
router.post('/:id/repost', requireAuth, toggleRepost);

router.get('/:id/comments', getComments);
router.post('/:id/comments', requireAuth, addComment);

module.exports = router;
