import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { generalLimiter } from './middleware/rateLimit.js';

const app = express();

const allowedOrigins = [
  'http://localhost:5173',
  'https://leave-managment-software.vercel.app',
  ...(process.env.CLIENT_URL || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
];

// Behind a proxy (Render/Railway/Nginx) so rate limiting and req.ip work.
app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true, // the refresh token lives in an httpOnly cookie
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(generalLimiter);

app.use('/api', routes);

// Registered last, in this order — Part 9.3.
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
