const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const attachmentStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'leave-attachments',
    allowed_formats: ['jpg', 'png', 'pdf'],
    resource_type: 'auto',
  },
});

const uploadAttachment = multer({
  storage: attachmentStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

const csvStorage = multer.memoryStorage();
const uploadCSV = multer({
  storage: csvStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

module.exports = { cloudinary, uploadAttachment, uploadCSV };
