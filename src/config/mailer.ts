import sgMail from "@sendgrid/mail";

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const sendCodeEmail = async (
  to: string,
  otp: string,
  { subject, heading, body }: { subject: string; heading: string; body: string },
) => {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    throw new Error("Email service is not configured");
  }

  await sgMail.send({
    to,
    from: process.env.SENDGRID_FROM_EMAIL,
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

// Generic free-text email — used by Vendor Intelligence's "reorder via
// email" action to send a plain reorder request to a vendor. Unlike
// sendCodeEmail above this carries no OTP, just a subject/body the caller
// composes, so it's kept as its own small function rather than bending
// sendCodeEmail's OTP-shaped template to fit.
export const sendReorderEmail = async (to: string, subject: string, body: string) => {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    throw new Error("Email service is not configured");
  }

  await sgMail.send({
    to,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject,
    text: body,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <p style="color:#333; font-size: 14px; white-space: pre-line;">${body}</p>
      </div>
    `,
  });
};
