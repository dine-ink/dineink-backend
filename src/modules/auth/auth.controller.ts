import { NextFunction, Request, Response } from "express";
import { ApiError } from "../../shared/apiError";
import {
  changePasswordService,
  loginUser,
  signupUser,
  sendSignupOtp,
  verifySignupOtpAndCreateUser,
  sendPasswordResetOtp,
  verifyPasswordResetOtpAndSetPassword,
  verifyManagerOverride,
} from "./auth.service";

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { identifier, password } = req.body;
    const data = await loginUser(identifier, password, {
      // `trust proxy` is set in index.ts, so req.ip is the caller's address
      // rather than the load balancer's.
      ip: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    });
    return res.status(200).json({
      success: true,
      message: "Login successful",
      token: data.token,
      user: data.user,
      restaurant: data.restaurant,
      branches: data.branches,
    });
  } catch (error: any) {
    // The lockout is an ApiError carrying its own 429 and an ACCOUNT_LOCKED
    // code the frontends branch on to show the reset prompt. Forward it to the
    // shared handler rather than flattening every failure to a bare 400, which
    // is what the rest of this module still does.
    if (error instanceof ApiError) return next(error);
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const signup = async (req: Request, res: Response) => {
  try {
    const { name, email, phone, password } = req.body;
    const data = await signupUser({
      name,
      email,
      phone,
      password,
    });
    return res.status(201).json({
      success: true,
      message: "Signup successful",
      token: data.token,
      user: data.user,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const sendSignupOtpHandler = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    await sendSignupOtp(email);
    return res.status(200).json({
      success: true,
      message: "Verification code sent",
    });
  } catch (error: any) {
    // SendGrid puts the actual reason (unverified sender, key missing the
    // mail.send scope, suppressed recipient) in response.body.errors — the
    // top-level message is just "Forbidden", which says nothing useful. Log
    // the detail server-side; the client still gets the short message.
    console.error(
      "[auth] signup OTP send failed:",
      error?.response?.body ?? error,
    );
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const verifySignupOtpHandler = async (req: Request, res: Response) => {
  try {
    const { name, email, phone, password, otp } = req.body;
    const data = await verifySignupOtpAndCreateUser({
      name,
      email,
      phone,
      password,
      otp,
    });
    return res.status(201).json({
      success: true,
      message: "Signup successful",
      token: data.token,
      user: data.user,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    await sendPasswordResetOtp(email);
    return res.status(200).json({
      success: true,
      message: "Verification code sent",
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { email, otp, newPassword } = req.body;
    await verifyPasswordResetOtpAndSetPassword({ email, otp, newPassword });
    return res.status(200).json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const verifyManagerOverrideHandler = async (req: any, res: Response) => {
  try {
    const { password } = req.body;
    const data = await verifyManagerOverride(req.user.restaurantId, password);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(401).json({ success: false, message: error.message });
  }
};

export const changePassword = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;
    await changePasswordService(userId, currentPassword, newPassword);
    return res.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
