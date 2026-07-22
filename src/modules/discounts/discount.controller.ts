import { Request, Response } from "express";
import {
  getDiscountCodesService,
  createDiscountCodeService,
  updateDiscountCodeService,
  deleteDiscountCodeService,
  validateDiscountCodeService,
} from "./discount.service";

export const getDiscountCodes = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const data = await getDiscountCodesService(restaurantId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const createDiscountCode = async (req: Request, res: Response) => {
  try {
    const data = await createDiscountCodeService((req as any).user.restaurantId, req.body);
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const updateDiscountCode = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = await updateDiscountCodeService(id, (req as any).user.restaurantId, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteDiscountCode = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteDiscountCodeService(id, (req as any).user.restaurantId);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const validateDiscountCode = async (req: Request, res: Response) => {
  try {
    const { code, subtotal } = req.body;
    const data = await validateDiscountCodeService(
      (req as any).user.restaurantId,
      code,
      Number(subtotal) || 0,
    );
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
