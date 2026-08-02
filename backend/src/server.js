import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/db.js';
import { startCrons } from './jobs/index.js';

const PORT = process.env.PORT || 5000;

const REQUIRED_ENV = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

async function start() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  await connectDB();
  startCrons();

  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}/api`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
