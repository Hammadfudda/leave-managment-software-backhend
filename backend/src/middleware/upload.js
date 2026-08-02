import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary.js';

/**
 * Spec Part 6.4 — File uploads never go directly from browser to Cloudinary.
 * An earlier prototype iteration did this and was deliberately reverted,
 * specifically so file-type/size validation can't be bypassed by tampering
 * with client-side code.
 */
const storage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'leave-attachments', allowed_formats: ['jpg', 'jpeg', 'png', 'pdf'] },
});

export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

/** CSV import stays in memory — it is parsed, never stored. */
export const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/csv|text\/plain|excel/i.test(file.mimetype) && !/\.csv$/i.test(file.originalname)) {
      return cb(new Error('Only .csv files are accepted.'));
    }
    cb(null, true);
  },
});
