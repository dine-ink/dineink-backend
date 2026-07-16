import { Request, Response } from "express";
import {
  changePasswordService,
  loginUser,
  signupUser,
  sendSignupOtp,
  verifySignupOtpAndCreateUser,
} from "./auth.service";

export const login = async (req: Request, res: Response) => {
  try {
    const { identifier, password } = req.body;
    const data = await loginUser(identifier, password);
    return res.status(200).json({
      success: true,
      message: "Login successful",
      token: data.token,
      user: data.user,
      restaurant: data.restaurant,
      branches: data.branches,
    });
  } catch (error: any) {
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
