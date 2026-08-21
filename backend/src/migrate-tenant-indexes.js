import 'dotenv/config';

import {
  connectDB,
} from './config/db.js';

import Department from './models/Department.js';
import Designation from './models/Designation.js';
import Grade from './models/Grade.js';
import RoleLabel from './models/RoleLabel.js';

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

  /*
   * Current pre-SaaS schemas use name: { unique: true }.
   * That creates a global name_1 unique index.
   *
   * SaaS needs Company A and Company B to both be able to create:
   * Engineering / Manager / Grade A, etc.
   *
   * This migration ONLY removes those four known global indexes.
   * It does not delete application data.
   */
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
