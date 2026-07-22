import { Request, Response } from "express";
import {
  getSopChecklists,
  createSopChecklist,
  updateSopChecklist,
  deleteSopChecklist,
} from "./sop.service";

export const getSopChecklistsHandler = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
    const data = await getSopChecklists(restaurantId, branchId);
    return res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to fetch SOP checklists" });
  }
};

export const createSopChecklistHandler = async (req: Request, res: Response) => {
  try {
    // Force the caller's own restaurantId — never trust a client-supplied
    // one, or any authenticated user could create checklists attributed to
    // (and cluttering) another restaurant.
    const data = await createSopChecklist({
      ...req.body,
      restaurantId: (req as any).user.restaurantId,
    });
    return res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to create SOP checklist" });
  }
};

export const updateSopChecklistHandler = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = await updateSopChecklist(id, req.body, (req as any).user.restaurantId);
    return res.json({ success: true, data });
  } catch (err: any) {
    console.log(err);
    return res.status(err.message === "SOP checklist not found" ? 404 : 500).json({
      success: false,
      message: err.message || "Failed to update SOP checklist",
    });
  }
};

export const deleteSopChecklistHandler = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = await deleteSopChecklist(id, (req as any).user.restaurantId);
    return res.json({ success: true, data });
  } catch (err: any) {
    console.log(err);
    return res.status(err.message === "SOP checklist not found" ? 404 : 500).json({
      success: false,
      message: err.message || "Failed to delete SOP checklist",
    });
  }
};
