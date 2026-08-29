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

/**
 * TLS is always on unless a developer explicitly turns it off.
 *
 * A local Postgres — the one in a Docker container, or a plain `brew install`
 * — doesn't offer SSL at all, and pg fails the connection outright rather than
 * falling back. Without an opt-out there is no way to run this backend against
 * a local database, which is why every developer ends up pointed at a shared
 * remote one.
 *
 * Deliberately an explicit env var rather than "off when the host looks local":
 * a hostname check would silently disable TLS for anything tunnelled or
 * port-forwarded to localhost, which is exactly when you still want it.
 */
const sslDisabled = process.env.DATABASE_SSL === "disable";

if (sslDisabled) {
  console.warn("[db] DATABASE_SSL=disable — connecting to Postgres WITHOUT TLS. Never do this outside local development.");
} else if (!ca) {
  console.warn(
    "[db] No DATABASE_CA_CERT set — the TLS connection to Postgres is encrypted but the server certificate is NOT verified.",
  );
}

const pool = new Pool({
  connectionString,
  max: 40,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: sslDisabled ? false : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
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
