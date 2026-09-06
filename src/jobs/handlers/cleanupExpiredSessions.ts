import prisma from "../../config/prisma";
import { registerHandler } from "../queue";

export const CLEANUP_EXPIRED_SESSIONS = "CLEANUP_EXPIRED_SESSIONS";

/**
 * Removes sessions and password-reset tokens that can no longer authenticate
 * anything.
 *
 * Both tables grow with every login and every reset request and nothing ever
 * removed a row. A dead session is not a security problem — the middleware
 * rejects it on expiry — but an unbounded table is an operational one, and a
 * password-reset token sitting in the database years after it was used is a
 * hash nobody needs to keep.
 *
 * Login attempts are NOT cleaned up here. They are the record of who tried to
 * get in, which is exactly what an investigation needs; deleting them on a
 * timer would remove evidence. If they need a retention policy it should be a
 * deliberate one with a stated period, not a side effect of housekeeping.
 */

/** How long a dead session is kept before removal. Long enough that the
 *  sessions list still shows recent activity, short enough to bound the table. */
const SESSION_RETENTION_DAYS = Number(process.env.SESSION_RETENTION_DAYS ?? 30);

const handler = async () => {
  const cutoff = new Date(Date.now() - SESSION_RETENTION_DAYS * 86_400_000);

  const sessions = await prisma.internalSession.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }],
    },
  });

  // Used or expired reset tokens. An outstanding one is left alone however old,
  // because deleting it would silently break a link somebody is about to click.
  const tokens = await prisma.internalPasswordResetToken.deleteMany({
    where: {
      OR: [{ usedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
    },
  });

  console.log(
    `[jobs] cleanup removed ${sessions.count} session(s) and ${tokens.count} reset token(s) older than ${SESSION_RETENTION_DAYS} days`,
  );
};

registerHandler(CLEANUP_EXPIRED_SESSIONS, handler);
