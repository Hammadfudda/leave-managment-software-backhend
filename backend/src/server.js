import 'dotenv/config';
import dns from 'node:dns';

import app from './app.js';
import { connectDB } from './config/db.js';

// Helps MongoDB Atlas SRV resolution on some environments.
try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (error) {
  console.warn('Could not override DNS servers:', error.message);
}

const REQUIRED_ENV = [
  'MONGODB_URI',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
];

const missingEnv = REQUIRED_ENV.filter(
  (key) => !process.env[key]
);

if (missingEnv.length > 0) {
  console.error(
    `Missing required environment variables: ${missingEnv.join(', ')}`
  );
}

/*
|--------------------------------------------------------------------------
| MongoDB connection cache
|--------------------------------------------------------------------------
| Vercel runs the backend as serverless functions.
| We reuse the connection between warm function invocations instead of
| creating a new MongoDB connection on every API request.
|--------------------------------------------------------------------------
*/

const globalForMongo = globalThis;

if (!globalForMongo.__leaveManagementDbPromise) {
  globalForMongo.__leaveManagementDbPromise = null;
}

async function ensureDatabaseConnection() {
  if (missingEnv.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingEnv.join(', ')}`
    );
  }

  if (!globalForMongo.__leaveManagementDbPromise) {
    globalForMongo.__leaveManagementDbPromise = connectDB().catch(
      (error) => {
        // Allow a later request to retry if the first connection fails.
        globalForMongo.__leaveManagementDbPromise = null;
        throw error;
      }
    );
  }

  return globalForMongo.__leaveManagementDbPromise;
}

/*
|--------------------------------------------------------------------------
| Vercel handler
|--------------------------------------------------------------------------
| Do NOT use app.listen() on Vercel.
| Every incoming request is passed to the Express app after MongoDB is ready.
|--------------------------------------------------------------------------
*/

export default async function handler(req, res) {
  try {
    await ensureDatabaseConnection();
    return app(req, res);
  } catch (error) {
    console.error('Backend initialization failed:', error);

    return res.status(500).json({
      success: false,
      message: 'Server initialization failed',
    });
  }
}

/*
|--------------------------------------------------------------------------
| Local development
|--------------------------------------------------------------------------
| `npm run dev` / `npm start` can still run the same file locally.
|--------------------------------------------------------------------------
*/

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;

  async function startLocalServer() {
    try {
      await ensureDatabaseConnection();

      const { startCrons } = await import('./jobs/index.js');
      startCrons();

      app.listen(PORT, () => {
        console.log(
          `API running locally on http://localhost:${PORT}/api`
        );
      });
    } catch (error) {
      console.error('Failed to start local server:', error);
      process.exit(1);
    }
  }

  startLocalServer();
}