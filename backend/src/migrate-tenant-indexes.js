import 'dotenv/config';
import dns from 'node:dns';

import {
  connectDB,
} from './config/db.js';

import Department from './models/Department.js';
import Designation from './models/Designation.js';
import Grade from './models/Grade.js';
import RoleLabel from './models/RoleLabel.js';

/*
 * Some Windows/router DNS setups resolve MongoDB SRV records in nslookup
 * but Node's c-ares resolver intermittently returns ECONNREFUSED.
 *
 * This affects only this one-off migration process.
 * Use public DNS servers for this script before connecting to MongoDB.
 */
dns.setServers([
  '8.8.8.8',
  '1.1.1.1',
]);

async function dropIfPresent(model, indexName) {
  const indexes = await model.collection.indexes();

  if (!indexes.some((index) => index.name === indexName)) {
    return;
  }

  await model.collection.dropIndex(indexName);

  console.log(
    `Dropped old global index: ${model.modelName}.${indexName}`
  );
}

async function run() {
  await connectDB();

  await dropIfPresent(Department, 'name_1');
  await dropIfPresent(Designation, 'name_1');
  await dropIfPresent(Grade, 'name_1');
  await dropIfPresent(RoleLabel, 'name_1');

  await Department.createIndexes();
  await Designation.createIndexes();
  await Grade.createIndexes();
  await RoleLabel.createIndexes();

  console.log('Tenant master-data indexes are ready.');
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
