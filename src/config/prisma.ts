import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
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

/**
 * TLS to RDS.
 *
 * Point DATABASE_CA_CERT at the AWS RDS CA bundle (or paste its contents into
 * DATABASE_CA_CERT_PEM) and the certificate is actually verified. Without it we
 * fall back to an encrypted-but-unverified connection, which is what this used
 * to do unconditionally — fine on a private same-region link, not something to
 * rely on. Download:
 * https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
 */
const caPath = process.env.DATABASE_CA_CERT;
const caInline = process.env.DATABASE_CA_CERT_PEM;
const ca = caInline ?? (caPath && fs.existsSync(caPath) ? fs.readFileSync(caPath, "utf8") : undefined);

if (!ca) {
  console.warn(
    "[db] No DATABASE_CA_CERT set — the TLS connection to Postgres is encrypted but the server certificate is NOT verified.",
  );
}

const pool = new Pool({
  connectionString,
  max: 40,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);

// SLOW_QUERY_MS surfaces individual queries worth optimising. Now that the
// database sits in the same region as the API, anything still over the
// threshold is real SQL execution time rather than network round trip.
const slowQueryMs = Number(process.env.SLOW_QUERY_MS ?? 0);

// Always configured as an event emitter (emitting with no listener attached
// costs nothing) — passing `log` conditionally would give the constructor a
// union type that Prisma's generated `Subset<>` signature rejects.
const prisma = new PrismaClient({
  adapter,
  log: [{ emit: "event", level: "query" }],
});

if (slowQueryMs > 0) {
  prisma.$on("query", (e) => {
    if (e.duration >= slowQueryMs) {
      console.warn(`[slow query] ${e.duration}ms  ${e.query.slice(0, 300)}`);
    }
  });
}

export default prisma;
