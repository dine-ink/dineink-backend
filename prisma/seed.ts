import prisma from "../src/config/prisma";
import { runSeed } from "../src/seed";

const fresh = process.argv.includes("--fresh");

async function main(): Promise<void> {
  try {
    await runSeed({ fresh });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
