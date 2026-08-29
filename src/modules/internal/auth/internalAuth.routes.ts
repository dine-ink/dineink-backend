import { Router } from "express";
import { internalAuth } from "../rbac/internalAuth.middleware";
import * as controller from "./internalAuth.controller";

const router = Router();

// ─── Unauthenticated ─────────────────────────────────────────────────────────
router.post("/login", controller.login);
router.post("/login/2fa", controller.loginTwoFactor);
router.post("/forgot-password", controller.forgotPassword);
router.post("/reset-password", controller.resetPassword);

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
