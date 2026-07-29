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
import { ForbiddenError } from "./addon.validation";

const handleError = (error: any, res: Response) => {
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res.status(400).json({ success: false, message: error.message });
};

export const getAddOnGroups = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const data = await getAddOnGroupsService(restaurantId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const createAddOnGroup = async (req: any, res: Response) => {
  try {
    const data = await createAddOnGroupService(Number(req.user.restaurantId), req.body);
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const updateAddOnGroup = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = await updateAddOnGroupService(Number(req.user.restaurantId), id, req.body.name);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const deleteAddOnGroup = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteAddOnGroupService(Number(req.user.restaurantId), id);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const createAddOn = async (req: any, res: Response) => {
  try {
    const data = await createAddOnService(Number(req.user.restaurantId), req.body);
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const updateAddOn = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = await updateAddOnService(Number(req.user.restaurantId), id, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const deleteAddOn = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteAddOnService(Number(req.user.restaurantId), id);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const attachAddOnGroup = async (req: any, res: Response) => {
  try {
    const menuItemId = Number(req.params.menuItemId);
    const { addOnGroupId } = req.body;
    const data = await attachAddOnGroupService(Number(req.user.restaurantId), menuItemId, Number(addOnGroupId));
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const detachAddOnGroup = async (req: any, res: Response) => {
  try {
    const menuItemId = Number(req.params.menuItemId);
    const addOnGroupId = Number(req.params.addOnGroupId);
    await detachAddOnGroupService(Number(req.user.restaurantId), menuItemId, addOnGroupId);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return handleError(error, res);
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
