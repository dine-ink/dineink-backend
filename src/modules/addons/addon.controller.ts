import { Request, Response } from "express";
import {
  getAddOnGroupsService,
  createAddOnGroupService,
  updateAddOnGroupService,
  deleteAddOnGroupService,
  createAddOnService,
  updateAddOnService,
  deleteAddOnService,
  attachAddOnGroupService,
  detachAddOnGroupService,
  getMenuItemAddOnGroupsService,
  getRestaurantAddOnAttachmentsService,
} from "./addon.service";

export const getAddOnGroups = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const data = await getAddOnGroupsService(restaurantId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const createAddOnGroup = async (req: Request, res: Response) => {
  try {
    const data = await createAddOnGroupService(req.body);
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const updateAddOnGroup = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = await updateAddOnGroupService(id, req.body.name);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteAddOnGroup = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteAddOnGroupService(id);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const createAddOn = async (req: Request, res: Response) => {
  try {
    const data = await createAddOnService(req.body);
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const updateAddOn = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = await updateAddOnService(id, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteAddOn = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteAddOnService(id);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const attachAddOnGroup = async (req: Request, res: Response) => {
  try {
    const menuItemId = Number(req.params.menuItemId);
    const { addOnGroupId } = req.body;
    const data = await attachAddOnGroupService(menuItemId, Number(addOnGroupId));
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const detachAddOnGroup = async (req: Request, res: Response) => {
  try {
    const menuItemId = Number(req.params.menuItemId);
    const addOnGroupId = Number(req.params.addOnGroupId);
    await detachAddOnGroupService(menuItemId, addOnGroupId);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getRestaurantAddOnAttachments = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const data = await getRestaurantAddOnAttachmentsService(restaurantId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getMenuItemAddOnGroups = async (req: Request, res: Response) => {
  try {
    const menuItemId = Number(req.params.menuItemId);
    const data = await getMenuItemAddOnGroupsService(menuItemId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
