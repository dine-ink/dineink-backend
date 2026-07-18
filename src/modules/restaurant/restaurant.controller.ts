import { Request, Response } from "express";

import prisma from "../../config/prisma";
import {
  setupRestaurantService,
  getShopsService,
  getMyRestaurantService,
  getBranchDetailsService,
  updateBranchDetailsService,
  getRestaurantStaffData,
  getTablesService,
  createRestaurantTableService,
  deleteRestaurantTableService,
  createStaffService,
  updateStaffService,
  getCategoriesService,
  createCategoryService,
  updateCategoryService,
  deleteCategoryService,
  createMenuItemService,
  updateMenuItemService,
  deleteMenuItemService,
} from "./restaurant.service";

export const setupRestaurant = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;

    // PARSE JSON STRING

    const body = JSON.parse(req.body.data);

    // ATTACH LOGO

    if (req.file) {
      body.restaurant.logo = `/uploads/${req.file.filename}`;
    }

    const data = await setupRestaurantService(userId, body);

    return res.status(200).json({
      success: true,
      token: data.token,
      user: data.user,
      restaurant: data.restaurant,
      branches: data.branches,
    });
  } catch (error: any) {
    console.log(error.stack);

    // Prisma unique constraint = duplicate email/phone
    const isDuplicate = error.code === "P2002";
    const field = error.meta?.target?.[0];
    const message = isDuplicate
      ? `A user with this ${field || "email or phone"} already exists. Please use a different value.`
      : error.message;

    return res.status(500).json({
      success: false,
      message,
    });
  }
};

export const getShops = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const data = await getShopsService(userId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getMyRestaurant = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const data = await getMyRestaurantService(userId);
    console.log(data, "data");
    return res.status(200).json({
      success: true,

      data,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getBranchDetails = async (req: Request, res: Response) => {
  try {
    const branchId = Number(req.params.id);
    const data = await getBranchDetailsService(branchId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateBranchDetails = async (req: Request, res: Response) => {
  try {
    const branchId = Number(req.params.id);
    const data = await updateBranchDetailsService(branchId, req.body);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getRestaurantStaff = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);

    const data = await getRestaurantStaffData(restaurantId, branchId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getTablesController = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const data = await getTablesService(restaurantId, branchId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const createRestaurantTable = async (req: Request, res: Response) => {
  try {
    const table = await createRestaurantTableService(req.body);

    return res.status(201).json({
      success: true,
      data: table,
    });
  } catch (error: any) {
    console.log(error);

    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const deleteRestaurantTable = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    await deleteRestaurantTableService(id);

    return res.status(200).json({
      success: true,
      message: "Table deleted",
    });
  } catch (error: any) {
    console.log(error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

// Update restaurant logo from the Shops page
export const updateRestaurantLogo = async (req: any, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }
    const restaurantId = Number(req.body.restaurantId);
    if (!restaurantId) {
      return res.status(400).json({ success: false, message: "restaurantId is required" });
    }
    const logoPath = `/uploads/${req.file.filename}`;
    await prisma.restaurant.update({
      where: { id: restaurantId },
      data: { logo: logoPath },
    });
    return res.status(200).json({ success: true, logo: logoPath });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createStaff = async (req: any, res: Response) => {
  try {
    const staff = await createStaffService(req.body);
    return res.status(201).json({ success: true, data: staff });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateStaff = async (req: any, res: Response) => {
  try {
    const userId = Number(req.params.id);
    const staff = await updateStaffService(userId, req.body);
    return res.status(200).json({ success: true, data: staff });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── Category controllers ─────────────────────────────────────────────────────

export const getCategories = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const data = await getCategoriesService(restaurantId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const createCategory = async (req: Request, res: Response) => {
  try {
    const data = await createCategoryService(req.body);
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const updateCategory = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = await updateCategoryService(id, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteCategory = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteCategoryService(id);
    return res.status(200).json({ success: true, message: "Category deleted" });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// ── MenuItem controllers ─────────────────────────────────────────────────────

export const createMenuItem = async (req: Request, res: Response) => {
  try {
    const data = await createMenuItemService(req.body);
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const updateMenuItem = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = await updateMenuItemService(id, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteMenuItem = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteMenuItemService(id);
    return res.status(200).json({ success: true, message: "Menu item deleted" });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
