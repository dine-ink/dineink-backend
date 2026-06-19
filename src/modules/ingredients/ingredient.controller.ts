import * as ingredientService from "./ingredient.service";
import { Request, Response } from "express";
import {
  createVendor,
  updateVendor,
  deleteVendor,
  updateIngredientPrice,
  getIngredientPriceHistory,
} from "./ingredient.service";

export const generateIngredients = async (req: any, res: any) => {
  try {
    const { restaurantId } = req.body;
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
    const { restaurantId, branchId, ingredients } = req.body;
    const data = await ingredientService.saveIngredients(
      restaurantId,
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
    const { restaurantId, branchId, vendors } = req.body;

    await ingredientService.uploadVendors(restaurantId, branchId, vendors);

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
    const vendor = await createVendor(req.body);
    return res.status(201).json({ success: true, data: vendor });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to create vendor" });
  }
};

export const updateVendorHandler = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const vendor = await updateVendor(id, req.body);
    return res.json({ success: true, data: vendor });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to update vendor" });
  }
};

export const deleteVendorHandler = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteVendor(id);
    return res.json({ success: true });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to delete vendor" });
  }
};

export const updateIngredientPriceHandler = async (req: Request, res: Response) => {
  try {
    const data = await updateIngredientPrice(req.body);
    return res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to update price" });
  }
};

export const getIngredientPriceHistoryHandler = async (req: Request, res: Response) => {
  try {
    const ingredientId = Number(req.params.ingredientId);
    const data = await getIngredientPriceHistory(ingredientId);
    return res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to fetch price history" });
  }
};
