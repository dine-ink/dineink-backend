import * as ingredientService from "./ingredient.service";
import { Request, Response } from "express";
import {
  createVendor,
  updateVendor,
  deleteVendor,
  updateIngredientPrice,
  getIngredientPriceHistory,
  getIngredientsByVendor,
} from "./ingredient.service";

export const generateIngredients = async (req: any, res: any) => {
  try {
    const restaurantId = req.user.restaurantId;
    const data = await ingredientService.generateIngredients(restaurantId);
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: "Failed to generate ingredients",
    });
  }
};

export const saveIngredients = async (req: any, res: any) => {
  try {
    const { branchId, ingredients } = req.body;
    const data = await ingredientService.saveIngredients(
      req.user.restaurantId,
      branchId,
      ingredients,
    );
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    console.log("SAVE INGREDIENT ERROR =", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to save ingredients" });
  }
};

export const getIngredients = async (req: any, res: any) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const data = await ingredientService.getIngredients(restaurantId);
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch ingredients",
    });
  }
};

export const getReorderAlerts = async (req: any, res: any) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const data = await ingredientService.getReorderAlertsService(restaurantId);
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch reorder alerts",
    });
  }
};

export const aiSuggestMapping = async (req: any, res: any) => {
  try {
    const restaurantId = req.user.restaurantId;

    const data = await ingredientService.aiSuggestMappingData(
      restaurantId,
      req.body,
    );

    res.json({
      success: true,
      data,
    });
  } catch (err: any) {
    console.log(err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

export const uploadVendors = async (req: any, res: any) => {
  try {
    const { branchId, vendors } = req.body;

    await ingredientService.uploadVendors(req.user.restaurantId, branchId, vendors);

    res.json({
      success: true,
    });
  } catch (err) {
    console.log(err);

    res.status(500).json({
      success: false,
      message: "Vendor upload failed",
    });
  }
};

export const getVendors = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const vendors = await ingredientService.fetchVendorsData(restaurantId, branchId);
    return res.json({ success: true, data: vendors });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to fetch vendors" });
  }
};

export const createVendorHandler = async (req: Request, res: Response) => {
  try {
    // Force the caller's own restaurantId — never a client-supplied one.
    const vendor = await createVendor({ ...req.body, restaurantId: (req as any).user.restaurantId });
    return res.status(201).json({ success: true, data: vendor });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to create vendor" });
  }
};

export const updateVendorHandler = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const vendor = await updateVendor(id, req.body, (req as any).user.restaurantId);
    return res.json({ success: true, data: vendor });
  } catch (err: any) {
    console.log(err);
    return res.status(err.message === "Vendor not found" ? 404 : 500).json({
      success: false,
      message: err.message || "Failed to update vendor",
    });
  }
};

export const deleteVendorHandler = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteVendor(id, (req as any).user.restaurantId);
    return res.json({ success: true });
  } catch (err: any) {
    console.log(err);
    return res.status(err.message === "Vendor not found" ? 404 : 500).json({
      success: false,
      message: err.message || "Failed to delete vendor",
    });
  }
};

export const updateIngredientPriceHandler = async (req: Request, res: Response) => {
  try {
    const data = await updateIngredientPrice({ ...req.body, restaurantId: (req as any).user.restaurantId });
    return res.json({ success: true, data });
  } catch (err: any) {
    console.log(err);
    return res.status(err.message === "Ingredient not found" ? 404 : 500).json({
      success: false,
      message: err.message || "Failed to update price",
    });
  }
};

export const getIngredientPriceHistoryHandler = async (req: Request, res: Response) => {
  try {
    const ingredientId = Number(req.params.ingredientId);
    const data = await getIngredientPriceHistory(ingredientId, (req as any).user.restaurantId);
    return res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to fetch price history" });
  }
};

export const getIngredientsByVendorHandler = async (req: Request, res: Response) => {
  try {
    const vendorId = Number(req.params.vendorId);
    const data = await getIngredientsByVendor(vendorId, (req as any).user.restaurantId);
    return res.json({ success: true, data });
  } catch (err: any) {
    console.log(err);
    return res.status(err.message === "Vendor not found" ? 404 : 500).json({
      success: false,
      message: err.message || "Failed to fetch vendor ingredients",
    });
  }
};
