import express from "express";
import {
  getSopChecklistsHandler,
  createSopChecklistHandler,
  updateSopChecklistHandler,
  deleteSopChecklistHandler,
} from "./sop.controller";
import { authMiddleware } from "../../middleware/auth";

const router = express.Router();

router.get("/:restaurantId", authMiddleware, getSopChecklistsHandler);
router.post("/", authMiddleware, createSopChecklistHandler);
router.put("/:id", authMiddleware, updateSopChecklistHandler);
router.delete("/:id", authMiddleware, deleteSopChecklistHandler);

export default router;
