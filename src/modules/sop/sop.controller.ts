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
    const data = await createSopChecklist(req.body);
    return res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to create SOP checklist" });
  }
};

export const updateSopChecklistHandler = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = await updateSopChecklist(id, req.body);
    return res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to update SOP checklist" });
  }
};

export const deleteSopChecklistHandler = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = await deleteSopChecklist(id);
    return res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to delete SOP checklist" });
  }
};
