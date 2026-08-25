import 'dotenv/config';
import dns from 'node:dns';

import app from './app.js';
import { connectDB } from './config/db.js';

try {
  dns.setServers([
    '8.8.8.8',
    '8.8.4.4',
  ]);
} catch (error) {
  console.warn(
    'Could not override DNS servers:',
    error.message
  );
}

const REQUIRED_ENV = [
  'MONGODB_URI',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
];

const missingEnv =
  REQUIRED_ENV.filter(
    (key) =>
      !process.env[key]
  );

if (
  missingEnv.length >
  0
) {
  console.error(
    `Missing required environment variables: ${missingEnv.join(', ')}`
  );
}

const globalForMongo =
  globalThis;

if (
  !globalForMongo.__leaveManagementDbPromise
) {
  globalForMongo.__leaveManagementDbPromise =
    null;
}

async function ensureDatabaseConnection() {
  if (
    missingEnv.length >
    0
  ) {
    throw new Error(
      `Missing required environment variables: ${missingEnv.join(', ')}`
    );
  }

  if (
    !globalForMongo.__leaveManagementDbPromise
  ) {
    globalForMongo.__leaveManagementDbPromise =
      connectDB().catch(
        (error) => {
          globalForMongo.__leaveManagementDbPromise =
            null;

          throw error;
        }
      );
  }

  return globalForMongo.__leaveManagementDbPromise;
}

export default async function handler(
  req,
  res
) {
  try {
    await ensureDatabaseConnection();

    return app(
      req,
      res
    );
  } catch (error) {
    console.error(
      'Backend initialization failed:',
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          'Server initialization failed',
      });
  }
}

if (
  !process.env.VERCEL
) {
  const PORT =
    process.env.PORT ||
    5000;

  async function startLocalServer() {
    try {
      await ensureDatabaseConnection();

      const {
        startCrons,
      } =
        await import(
          './jobs/index.js'
        );

      startCrons();

      app.listen(
        PORT,
        () => {
          console.log(
            `API running locally on http://localhost:${PORT}/api`
          );
        }
      );
    } catch (error) {
      console.error(
        'Failed to start local server:',
        error
      );

      process.exit(
        1
      );
    }
  }

  startLocalServer();
}
