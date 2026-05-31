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
      data,
    });
  } catch (error: any) {
    console.log(error.stack);

    return res.status(500).json({
      success: false,
      message: error.message,
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
