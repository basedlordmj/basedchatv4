const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { UPLOAD_DIR: UPLOAD_ROOT } = require('../config/paths');

function makeStorage(subdir) {
  const dest = path.join(UPLOAD_ROOT, subdir);
  fs.mkdirSync(dest, { recursive: true });
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dest),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      const name = crypto.randomBytes(16).toString('hex') + ext.toLowerCase();
      cb(null, name);
    },
  });
}

const videoUpload = multer({
  storage: makeStorage('videos'),
  limits: { fileSize: Number(process.env.MAX_VIDEO_MB || 200) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('video/')) return cb(new Error('File must be a video'));
    cb(null, true);
  },
});

const imageUpload = multer({
  storage: makeStorage('backgrounds'),
  limits: { fileSize: Number(process.env.MAX_IMAGE_MB || 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|gif|jpeg|webp)$/.test(file.mimetype)) {
      return cb(new Error('File must be a PNG, GIF, JPEG, or WEBP image'));
    }
    cb(null, true);
  },
});

module.exports = { videoUpload, imageUpload };
