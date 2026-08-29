import { sendInternalPasswordResetEmail } from "../../../config/mailer";
import { clientIp } from "../rbac/internalAuth.middleware";
import { PERMISSION_GROUPS } from "../rbac/permissions";
import { asyncHandler, badRequest } from "../shared/apiError";
import * as service from "./internalAuth.service";

const PASSWORD_RESET_TTL_MINUTES = 30;

const requestContext = (req: any) => ({
  ip: clientIp(req),
  userAgent: req.headers["user-agent"] as string | undefined,
  req,
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) throw badRequest("Enter your company email and password.", "MISSING_CREDENTIALS");

  const result = await service.login(email, password, requestContext(req));
  return res.json({ success: true, data: result });
});

export const loginTwoFactor = asyncHandler(async (req, res) => {
  const { challengeToken, code } = req.body ?? {};
  if (!challengeToken || !code) throw badRequest("Enter the 6-digit code from your authenticator app.", "MISSING_2FA_CODE");

  const result = await service.completeTwoFactorLogin(challengeToken, code, requestContext(req));
  return res.json({ success: true, data: result });
});

export const me = asyncHandler(async (req, res) => {
  const user = await service.buildSessionUser(req.internal.id);
  return res.json({
    success: true,
    data: {
      user,
      // Shipped with the session so the frontend can render the roles screen
      // and permission labels without a second round trip. It is descriptive
      // metadata only — nothing here grants anything.
      permissionCatalog: PERMISSION_GROUPS,
    },
  });
});

export const logout = asyncHandler(async (req, res) => {
  await service.logout(req);
  return res.json({ success: true });
});

export const listSessions = asyncHandler(async (req, res) => {
  const sessions = await service.listMySessions(req.internal.id, req.internal.sessionId);
  return res.json({ success: true, data: sessions });
});

export const revokeSession = asyncHandler(async (req, res) => {
  await service.revokeSession(req, Number(req.params.id));
  return res.json({ success: true });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) throw badRequest("Enter your current and new password.", "MISSING_FIELDS");
  await service.changePassword(req, currentPassword, newPassword);
  return res.json({ success: true });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body ?? {};
  const result = await service.requestPasswordReset(email, { ip: clientIp(req), req });

  if (result.token && result.user) {
    const baseUrl = process.env.INTERNAL_WEB_URL || "http://localhost:5175";
    const resetUrl = `${baseUrl.replace(/\/$/, "")}/reset-password?token=${result.token}`;
    try {
      await sendInternalPasswordResetEmail(result.user.email, result.user.name, resetUrl, PASSWORD_RESET_TTL_MINUTES);
    } catch (error) {
      // A mail failure must not change the response — otherwise the difference
      // between "sent" and "failed" reveals whether the address exists.
      console.error("[internal-auth] password reset email failed to send", error);
    }
  }

  return res.json({
    success: true,
    message: "If that address belongs to a DineInk account, a reset link is on its way.",
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body ?? {};
  if (!token || !newPassword) throw badRequest("The reset link is incomplete. Request a new one.", "MISSING_FIELDS");
  await service.completePasswordReset(token, newPassword, req);
  return res.json({ success: true });
});

export const beginTwoFactorSetup = asyncHandler(async (req, res) => {
  const data = await service.beginTwoFactorSetup(req);
  return res.json({ success: true, data });
});

export const confirmTwoFactorSetup = asyncHandler(async (req, res) => {
  const { code } = req.body ?? {};
  if (!code) throw badRequest("Enter the 6-digit code from your authenticator app.", "MISSING_2FA_CODE");
  await service.confirmTwoFactorSetup(req, code);
  return res.json({ success: true });
});

export const disableTwoFactor = asyncHandler(async (req, res) => {
  const { password } = req.body ?? {};
  if (!password) throw badRequest("Confirm your password to turn off two-factor authentication.", "MISSING_FIELDS");
  await service.disableTwoFactor(req, password);
  return res.json({ success: true });
});
