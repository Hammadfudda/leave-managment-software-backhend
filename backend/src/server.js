import 'dotenv/config';
import dns from 'node:dns';

import app from './app.js';
import { connectDB } from './config/db.js';
import { startCrons } from './jobs/index.js';

// Fix MongoDB Atlas SRV DNS resolution on networks
// where the system DNS refuses Node.js SRV queries.
dns.setServers(['8.8.8.8', '8.8.4.4']);

const PORT = process.env.PORT || 5000;

const REQUIRED_ENV = [
  'MONGODB_URI',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
];

async function start() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);

  if (missing.length) {
    console.error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
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