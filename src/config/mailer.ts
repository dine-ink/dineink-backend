import sgMail from "@sendgrid/mail";

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

export const sendOtpEmail = async (to: string, otp: string) => {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    throw new Error("Email service is not configured");
  }

  await sgMail.send({
    to,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject: "Your DineInk verification code",
    text: `Your DineInk verification code is ${otp}. It expires in 10 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 420px; margin: 0 auto; padding: 24px;">
        <h2 style="color:#b10000; margin-bottom: 8px;">Verify your email</h2>
        <p style="color:#333; font-size: 14px;">Use the code below to finish creating your DineInk account. It expires in 10 minutes.</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; background:#f7f4ef; color:#201a17; padding: 16px 24px; border-radius: 8px; text-align:center; margin: 16px 0;">
          ${otp}
        </div>
        <p style="color:#78716c; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
};
