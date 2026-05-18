import { Router } from "express";
import {
  saveRunningOrder,
  getRunningOrderByTable,
  closeRunningOrder,
} from "./runningOrder.controller";

const router = Router();

router.post("/saveRunningOrder", saveRunningOrder);
router.get("/:tableId/runningOrdertable", getRunningOrderByTable);
router.post("/closeRunningOrder", closeRunningOrder);

export default router;
