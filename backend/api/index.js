import app from '../src/app.js';
import { connectDB } from '../src/config/db.js';

let dbPromise;

async function ensureDatabase() {
  if (!dbPromise) {
    dbPromise = connectDB().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }

  return dbPromise;
}

export default async function handler(req, res) {
  try {
    await ensureDatabase();
    return app(req, res);
  } catch (error) {
    console.error('Vercel API initialization error:', error);

    return res.status(500).json({
      success: false,
      message: 'Server initialization failed',
    });
  }
}