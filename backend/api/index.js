import app from '../src/app.js';
import { connectDB } from '../src/config/db.js';

let databaseConnection;

export default async function handler(req, res) {
  databaseConnection ??= connectDB().catch((error) => {
    databaseConnection = undefined;
    throw error;
  });

  await databaseConnection;
  return app(req, res);
}