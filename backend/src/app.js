import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import routes from './routes/index.js';

import {
  errorHandler,
  notFoundHandler,
} from './middleware/errorHandler.js';

import {
  generalLimiter,
} from './middleware/rateLimit.js';

const app =
  express();

app.set(
  'trust proxy',
  1
);

const envOrigins =
  (
    process.env.CLIENT_URL ||
    ''
  )
    .split(',')
    .map(
      (origin) =>
        origin.trim()
    )
    .filter(
      Boolean
    );

const allowedOrigins = [
  'http://localhost:5173',
  'https://leave-managment-software.vercel.app',
  ...envOrigins,
];

const corsOptions = {
  origin(
    origin,
    callback
  ) {
    if (!origin) {
      return callback(
        null,
        true
      );
    }

    if (
      allowedOrigins.includes(
        origin
      )
    ) {
      return callback(
        null,
        true
      );
    }

    console.warn(
      `CORS blocked origin: ${origin}`
    );

    console.warn(
      'Allowed origins:',
      allowedOrigins
    );

    return callback(
      new Error(
        `CORS blocked origin: ${origin}`
      )
    );
  },

  credentials:
    true,

  methods: [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
  ],

  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
  ],

  optionsSuccessStatus:
    204,
};

app.use(
  cors(
    corsOptions
  )
);

app.options(
  '*',
  cors(
    corsOptions
  )
);

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy:
        'cross-origin',
    },
  })
);

/*
 * Preserve raw JSON bytes so the public QStash webhook can verify the
 * Upstash-Signature body hash exactly. All normal routes still receive the
 * usual parsed req.body object.
 */
app.use(
  express.json({
    limit:
      '1mb',

    verify(
      req,
      _res,
      buffer
    ) {
      req.rawBody =
        buffer.toString(
          'utf8'
        );
    },
  })
);

app.use(
  express.urlencoded({
    extended:
      true,
    limit:
      '1mb',
  })
);

app.use(
  cookieParser()
);

app.get(
  '/api/health',
  (
    req,
    res
  ) => {
    res
      .status(
        200
      )
      .json({
        success:
          true,
        message:
          'Leave Management API is running',
      });
  }
);

app.use(
  generalLimiter
);

app.use(
  '/api',
  routes
);

app.use(
  notFoundHandler
);

app.use(
  errorHandler
);

export default app;
