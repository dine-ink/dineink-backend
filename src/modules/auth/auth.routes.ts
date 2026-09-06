import express from "express";
import {
  changePassword,
  login,
  signup,
  sendSignupOtpHandler,
  verifySignupOtpHandler,
  forgotPassword,
  resetPassword,
  verifyManagerOverrideHandler,
} from "./auth.controller";
import { authMiddleware } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { authRateLimiter, passwordResetRateLimiter } from "../../middleware/rateLimit";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  managerOverrideSchema,
  resetPasswordSchema,
  sendSignupOtpSchema,
  signupSchema,
  verifySignupOtpSchema,
} from "./auth.validation";

/**
 * Three layers guard these routes, and they cover different attacks:
 *
 *   - `authRateLimiter` is per IP address. It stops one host hammering the
 *     endpoint, and it is the only thing that helps against password *spraying*
 *     — one password tried across many accounts, where no single account ever
 *     accumulates enough failures to lock.
 *   - The per-account lockout in `auth.lockout` is the other half: it stops a
 *     distributed attack on one known account, which the IP limiter cannot see.
 *   - `validateBody` refuses malformed input before either of the above spends
 *     a database round trip or a bcrypt comparison on it.
 *
 * `passwordResetRateLimiter` is tighter still on the two endpoints that send
 * mail, because abusing those costs someone else's inbox and our sending
 * reputation rather than just our CPU.
 */
const router = express.Router();

router.post("/login", authRateLimiter, validateBody(loginSchema), login);
router.post("/signup", authRateLimiter, validateBody(signupSchema), signup);

router.post(
  "/signup/send-otp",
  passwordResetRateLimiter,
  validateBody(sendSignupOtpSchema),
  sendSignupOtpHandler,
);
router.post(
  "/signup/verify-otp",
  authRateLimiter,
  validateBody(verifySignupOtpSchema),
  verifySignupOtpHandler,
);

router.post(
  "/forgot-password",
  passwordResetRateLimiter,
  validateBody(forgotPasswordSchema),
  forgotPassword,
);
router.post(
  "/reset-password",
  authRateLimiter,
  validateBody(resetPasswordSchema),
  resetPassword,
);

router.put(
  "/change-password",
  authMiddleware,
  validateBody(changePasswordSchema),
  changePassword,
);
router.post(
  "/verify-manager-override",
  authMiddleware,
  authRateLimiter,
  validateBody(managerOverrideSchema),
  verifyManagerOverrideHandler,
);

export default router;
