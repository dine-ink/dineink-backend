import express from "express";
import { changePassword, login, signup } from "./auth.controller";
import { authMiddleware } from "../../middleware/auth";

const router = express.Router();
router.post("/login", login);
router.post("/signup", signup);
router.put("/change-password", authMiddleware, changePassword);

export default router;
