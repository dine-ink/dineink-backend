import dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "../../generated/prisma";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

// Strip sslmode from the URL so pg doesn't treat "require" as "verify-full"
// (pg v8 changed behaviour: require/prefer/verify-ca are aliases for verify-full).
// We set ssl explicitly on the Pool instead.
const rawUrl = process.env.DATABASE_URL as string;
const connectionString = rawUrl.replace(/([?&])sslmode=[^&]+(&|$)/, (_m, pre, post) =>
  post ? pre : "",
);
const pool = new Pool({
  connectionString,
  max: 40,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
export default prisma;
