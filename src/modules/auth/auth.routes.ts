import express from "express";
import {
  changePassword,
  login,
  signup,
  sendSignupOtpHandler,
  verifySignupOtpHandler,
  forgotPassword,
  resetPassword,
} from "./auth.controller";
import { authMiddleware } from "../../middleware/auth";

const router = express.Router();
router.post("/login", login);
router.post("/signup", signup);
router.post("/signup/send-otp", sendSignupOtpHandler);
router.post("/signup/verify-otp", verifySignupOtpHandler);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.put("/change-password", authMiddleware, changePassword);

export default router;
