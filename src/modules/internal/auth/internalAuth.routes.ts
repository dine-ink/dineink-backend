import { Router } from "express";
import { internalAuth } from "../rbac/internalAuth.middleware";
import { authRateLimiter, passwordResetRateLimiter } from "../../../middleware/rateLimit";
import * as controller from "./internalAuth.controller";

const router = Router();

// ─── Unauthenticated ─────────────────────────────────────────────────────────
// Per-IP limits sit in front of the per-account lockout: the lockout stops
// someone guessing one person's password, these stop one address working
// through the whole staff list, or flooding the mailer.
router.post("/login", authRateLimiter, controller.login);
router.post("/login/2fa", authRateLimiter, controller.loginTwoFactor);
router.post("/forgot-password", passwordResetRateLimiter, controller.forgotPassword);
router.post("/reset-password", passwordResetRateLimiter, controller.resetPassword);

// ─── Authenticated ───────────────────────────────────────────────────────────
router.get("/me", internalAuth, controller.me);
router.post("/logout", internalAuth, controller.logout);
router.post("/change-password", internalAuth, controller.changePassword);
router.get("/sessions", internalAuth, controller.listSessions);
router.delete("/sessions/:id", internalAuth, controller.revokeSession);
router.post("/2fa/setup", internalAuth, controller.beginTwoFactorSetup);
router.post("/2fa/confirm", internalAuth, controller.confirmTwoFactorSetup);
router.post("/2fa/disable", internalAuth, controller.disableTwoFactor);

export default router;
