import express from "express";
import {
  getSopChecklistsHandler,
  createSopChecklistHandler,
  updateSopChecklistHandler,
  deleteSopChecklistHandler,
} from "./sop.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant } from "../../middleware/authorize";
import { validateBody } from "../../middleware/validate";
import { createSopSchema, updateSopSchema } from "./sop.validation";

const router = express.Router();

router.get("/:restaurantId", authMiddleware, requireOwnRestaurant(), getSopChecklistsHandler);
router.post("/", authMiddleware, validateBody(createSopSchema), createSopChecklistHandler);
// The schema is what stops `req.body` reaching `prisma.update` with fields the
// update was never meant to include — `restaurantId` in particular. See
// sop.validation.ts.
router.put("/:id", authMiddleware, validateBody(updateSopSchema), updateSopChecklistHandler);
router.delete("/:id", authMiddleware, deleteSopChecklistHandler);

export default router;
