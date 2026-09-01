const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { imageUpload } = require('../middleware/upload');
const {
  listMine,
  create,
  getMessages,
  postMessage,
  setBackground,
} = require('../controllers/conversationsController');

router.use(requireAuth);

router.get('/', listMine);
router.post('/', create);
router.get('/:id/messages', getMessages);
router.post('/:id/messages', postMessage);
router.post('/:id/background', imageUpload.single('image'), setBackground);

module.exports = router;
