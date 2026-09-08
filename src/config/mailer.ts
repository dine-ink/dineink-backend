import sgMail from "@sendgrid/mail";

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

/**
 * Refuses to attempt a send that cannot work, and says why — in the log.
 *
 * The message that reaches the caller deliberately does not name environment
 * variables. Someone halfway through creating an account can do nothing with
 * "SENDGRID_API_KEY is not set", and an unauthenticated caller should not be
 * told which parts of the deployment are unconfigured. The operator gets the
 * specifics from the server log and, since `config/secrets.ts` now checks these
 * at boot, from the deploy log before any customer sees this at all.
 *
 * Whitespace counts as missing: a variable set to " " passes a truthiness check
 * and then fails inside SendGrid with an opaque error.
 */
const assertMailerConfigured = (): string => {
  const missing = (["SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL"] as const).filter(
    (key) => !process.env[key]?.trim(),
  );

  if (missing.length) {
    console.error(
      `[mailer] Cannot send email — ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set. ` +
        "Set it in the deployment's environment configuration and redeploy.",
    );
    throw new Error(
      "We couldn't send that email just now. Please try again in a few minutes.",
    );
  }

  // Returned rather than read again at each call site: that is what tells the
  // compiler the address is present, and it trims a trailing space that would
  // otherwise be rejected by SendGrid as a malformed sender.
  return process.env.SENDGRID_FROM_EMAIL!.trim();
};

const sendCodeEmail = async (
  to: string,
  otp: string,
  { subject, heading, body }: { subject: string; heading: string; body: string },
) => {
  const from = assertMailerConfigured();

  await sgMail.send({
    to,
    from,
    subject,
    text: `${body} Your code is ${otp}. It expires in 10 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 420px; margin: 0 auto; padding: 24px;">
        <h2 style="color:#b10000; margin-bottom: 8px;">${heading}</h2>
        <p style="color:#333; font-size: 14px;">${body} It expires in 10 minutes.</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; background:#f7f4ef; color:#201a17; padding: 16px 24px; border-radius: 8px; text-align:center; margin: 16px 0;">
          ${otp}
        </div>
        <p style="color:#78716c; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
};

export const sendOtpEmail = (to: string, otp: string) =>
  sendCodeEmail(to, otp, {
    subject: "Your DineInk verification code",
    heading: "Verify your email",
    body: "Use the code below to finish creating your DineInk account.",
  });

export const sendPasswordResetOtpEmail = (to: string, otp: string) =>
  sendCodeEmail(to, otp, {
    subject: "Your DineInk password reset code",
    heading: "Reset your password",
    body: "Use the code below to reset your DineInk account password.",
  });

/**
 * Password reset for a DineInk employee on the internal console.
 *
 * A single-use link rather than the 6-digit OTP the restaurant apps use: an
 * internal account can suspend restaurants and change permissions, so its reset
 * factor is a 256-bit token that can't be brute-forced in the way a six-digit
 * code can, and only its SHA-256 hash is ever stored.
 */
export const sendInternalPasswordResetEmail = async (
  to: string,
  name: string,
  resetUrl: string,
  expiresInMinutes: number,
) => {
  const from = assertMailerConfigured();

  await sgMail.send({
    to,
    from,
    subject: "Reset your DineInk internal password",
    text:
      `Hi ${name},\n\nUse this link to set a new password for the DineInk internal console:\n${resetUrl}\n\n` +
      `The link expires in ${expiresInMinutes} minutes and can only be used once. ` +
      `If you didn't request it, ignore this email — your password stays unchanged.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color:#b10000; margin-bottom: 8px;">Reset your password</h2>
        <p style="color:#333; font-size: 14px;">Hi ${name}, use the button below to set a new password for the DineInk internal console.</p>
        <p style="margin: 24px 0;">
          <a href="${resetUrl}" style="background:#b10000; color:#fff; text-decoration:none; padding:12px 20px; border-radius:8px; font-size:14px; font-weight:bold; display:inline-block;">Set a new password</a>
        </p>
        <p style="color:#78716c; font-size: 12px;">This link expires in ${expiresInMinutes} minutes and can only be used once. If you didn't request it, ignore this email — your password stays unchanged.</p>
      </div>
    `,
  });
};

// Generic free-text email — used by Vendor Intelligence's "reorder via
// email" action to send a plain reorder request to a vendor. Unlike
// sendCodeEmail above this carries no OTP, just a subject/body the caller
// composes, so it's kept as its own small function rather than bending
// sendCodeEmail's OTP-shaped template to fit.
export const sendReorderEmail = async (to: string, subject: string, body: string) => {
  const from = assertMailerConfigured();

  await sgMail.send({
    to,
    from,
    subject,
    text: body,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <p style="color:#333; font-size: 14px; white-space: pre-line;">${body}</p>
      </div>
    `,
  });
};
