import { PrismaClient } from '@prisma/client';
import { ensureDefaultData } from '../src/pipeline/ensureDefaults.js';

const prisma = new PrismaClient();

// The actual default-data logic lives in src/pipeline/ensureDefaults.ts,
// which also runs automatically on every server boot (main.ts) — this
// script just exists as an explicit, on-demand way to run the same
// idempotent seeding for local dev, per README.md.
async function main() {
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  await ensureDefaultData();

  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
