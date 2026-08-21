import 'dotenv/config';

import bcrypt from 'bcryptjs';

import { connectDB } from './config/db.js';
import SuperAdmin from './models/SuperAdmin.js';

async function run() {
  const email = String(process.env.SUPER_ADMIN_EMAIL || '')
    .trim()
    .toLowerCase();

  const password = String(process.env.SUPER_ADMIN_PASSWORD || '');

  const fullName = String(
    process.env.SUPER_ADMIN_NAME || 'SaaS Owner'
  ).trim();

  if (!email || !password) {
    throw new Error(
      'SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required in backend/.env'
    );
  }

  if (password.length < 10) {
    throw new Error(
      'SUPER_ADMIN_PASSWORD must be at least 10 characters.'
    );
  }

  await connectDB();

  const existing = await SuperAdmin.findOne({ email });

  if (existing) {
    existing.fullName = fullName;
    existing.passwordHash = await bcrypt.hash(password, 12);
    existing.status = 'active';

    await existing.save();

    console.log(`Super Admin updated: ${email}`);
  } else {
    await SuperAdmin.create({
      fullName,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      status: 'active',
    });

    console.log(`Super Admin created: ${email}`);
  }

  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
