import app from '../src/app.js';
import { connectDB } from '../src/config/db.js';
import { migrateLegacyTenantOwnership } from '../src/jobs/tenantMigration.js';

let databaseConnection;
let tenantMigration;

export default async function handler(req, res) {
  databaseConnection ??= connectDB().catch((error) => {
    databaseConnection = undefined;
    throw error;
  });

  await databaseConnection;
  tenantMigration ??= migrateLegacyTenantOwnership();
  await tenantMigration;
  return app(req, res);
}