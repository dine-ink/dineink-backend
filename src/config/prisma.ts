import dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "../../generated/prisma";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL as string;
const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 3_000,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
export default prisma;
