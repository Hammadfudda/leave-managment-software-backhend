import multer from 'multer';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const allowedAttachmentMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
]);

export const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_FILE_SIZE,
  },

  fileFilter: (
    req,
    file,
    cb
  ) => {
    if (
      !allowedAttachmentMimeTypes.has(
        file.mimetype
      )
    ) {
      return cb(
        new Error(
          'Only PDF, JPG, JPEG and PNG files are allowed.'
        )
      );
    }

    cb(null, true);
  },
});

export const uploadCsv = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_FILE_SIZE,
  },

  fileFilter: (
    req,
    file,
    cb
  ) => {
    const isCsvMime =
      /csv|text\/plain|excel/i.test(
        file.mimetype
      );

    const isCsvExtension =
      /\.csv$/i.test(
        file.originalname
      );

    if (
      !isCsvMime &&
      !isCsvExtension
    ) {
      return cb(
        new Error(
          'Only .csv files are accepted.'
        )
      );
    }

    cb(null, true);
  },
});