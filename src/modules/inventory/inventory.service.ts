import prisma from "../../config/prisma";

// Converts a recipe quantity (in the recipe's own unit, e.g. "gm") into the
// ingredient's stock-tracking unit (e.g. "Kg") so wastage/consumption math
// never mixes grams against kilograms (or ml against litres) unconverted.
export const convertQtyToIngredientUnit = (
  qty: number,
  fromUnit?: string | null,
  toUnit?: string | null,
) => {
  const from = (fromUnit || "").toLowerCase();
  const to = (toUnit || "").toLowerCase();
  if (!from || !to || from === to) return qty;
  if (to === "kg" && (from === "gram" || from === "gm" || from === "g")) return qty / 1000;
  if (to === "litre" && (from === "ml" || from === "milliliter" || from === "millilitre")) return qty / 1000;
  return qty;
};

export const getMenuManagementService = async (
  restaurantId: number,
  branchId?: number,
) => {
  const [menuItems, ingredients, categories, restocks] = await Promise.all([
    prisma.menuItem.findMany({
      where: {
        restaurantId,
        isDeleted: false,
      },

      include: {
        category: true,
        menuItemIngredients: {
          include: {
            ingredient: {
              include: {
                category: true,
              },
            },
          },
        },
      },

      orderBy: {
        createdAt: "desc",
      },
    }),

    prisma.ingredient.findMany({
      where: {
        restaurantId,
      },

      include: {
        category: true,
        ingredientVendors: {
          where: {
            branchId,
          },
          include: {
            vendor: true,
          },
        },
      },

      orderBy: {
        createdAt: "desc",
      },
    }),

    prisma.ingredientCategory.findMany({
      where: {
        restaurantId,
      },
    }),

    prisma.inventoryRestock.findMany({
      where: {
        restaurantId,

        ...(branchId && {
          branchId,
        }),
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
  ]);

  return {
    menuItems,
    ingredients,
    categories,
    restocks,
  };
};

export const saveMenuItemMappingData = async (
  restaurantId: number,
  body: any,
) => {
  const { menuItemId, ingredients } = body;

  // VERIFY MENU ITEM

  const menuItem = await prisma.menuItem.findFirst({
    where: {
      id: menuItemId,
      restaurantId,
    },
  });

  if (!menuItem) {
    throw new Error("Menu item not found");
  }

  // VERIFY INGREDIENTS

  const ingredientIds = ingredients.map((i: any) => i.ingredientId);

  const validIngredients = await prisma.ingredient.findMany({
    where: {
      id: {
        in: ingredientIds,
      },

      restaurantId,
    },
  });

  if (validIngredients.length !== ingredientIds.length) {
    throw new Error("Invalid ingredients");
  }

  // DELETE OLD

  await prisma.menuItemIngredient.deleteMany({
    where: {
      menuItemId,
    },
  });

  // CREATE NEW

  if (ingredients?.length) {
    await prisma.menuItemIngredient.createMany({
      data: ingredients.map((item: any) => ({
        menuItemId,

        ingredientId: item.ingredientId,

        quantity: Number(item.quantity),

        unit: item.unit,

        wastage: Number(item.wastage || 0),
      })),
    });
  }

  return true;
};

export const getMenuItemMappingData = async (restaurantId: number) => {
  return await prisma.menuItem.findMany({
    where: {
      restaurantId,
    },

    include: {
      category: true,

      menuItemIngredients: {
        include: {
          ingredient: {
            include: {
              category: true,
            },
          },
        },
      },
    },
  });
};

export const saveRestockHistoryData = async (
  restaurantId: number,
  branchId: number,
  month: number,
  year: number,
  data: any,
) => {
  return prisma.inventoryRestock.upsert({
    where: {
      restaurantId_branchId_month_year: {
        restaurantId,
        branchId,
        month,
        year,
      },
    },

    update: {
      data,
    },

    create: {
      restaurantId,
      branchId,
      month,
      year,
      data,
    },
  });
};

export const getRestockHistoryData = async (
  restaurantId: number,
  branchId?: number,
) => {
  return prisma.inventoryRestock.findMany({
    where: {
      restaurantId,
      ...(branchId && { branchId }),
    },
    orderBy: { createdAt: "desc" },
  });
};

// ─── getInventoryAdjustmentsService ──────────────────────────────────────────

// ─── getDailyAuditPreviewService ─────────────────────────────────────────────
// Returns all ingredients for a branch with opening qty + SOP consumption for a date.
// Called before staff enter closing qty — gives them the pre-filled view.
export const getDailyAuditPreviewService = async (
  restaurantId: number,
  branchId: number,
  date: string, // "YYYY-MM-DD"
) => {
  const dayStart = new Date(date + "T00:00:00.000Z");
  const dayEnd = new Date(date + "T23:59:59.999Z");

  // Previous day's closing stock per ingredient
  const prevDate = new Date(dayStart);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);

  const [ingredients, prevAudits, bills] = await Promise.all([
    prisma.ingredient.findMany({
      where: { restaurantId },
      select: { id: true, name: true, unit: true, quantity: true, pricePerUnit: true },
    }),
    prisma.dailyStockAudit.findMany({
      where: { branchId, auditDate: prevDate },
      select: { ingredientId: true, closingQty: true },
    }),
    prisma.bill.findMany({
      where: { restaurantId, branchId, status: "PAID", createdAt: { gte: dayStart, lte: dayEnd } },
      select: { items: { select: { menuItemId: true, quantity: true } } },
    }),
  ]);

  // Previous closing → opening for today
  const prevClosingMap = new Map(prevAudits.map((a) => [a.ingredientId, a.closingQty]));

  // SOP consumption from today's bills
  const menuItemIds = [
    ...new Set(bills.flatMap((b) => b.items.filter((i) => i.menuItemId).map((i) => i.menuItemId!))),
  ];
  const menuItemIngredients =
    menuItemIds.length > 0
      ? await prisma.menuItemIngredient.findMany({
          where: { menuItemId: { in: menuItemIds } },
          select: { menuItemId: true, ingredientId: true, quantity: true, unit: true },
        })
      : [];

  const ingredientUnitMap = new Map(ingredients.map((i) => [i.id, i.unit]));

  const miiMap = new Map<number, { ingredientId: number; quantity: number; unit: string | null }[]>();
  for (const mii of menuItemIngredients) {
    if (!miiMap.has(mii.menuItemId)) miiMap.set(mii.menuItemId, []);
    miiMap.get(mii.menuItemId)!.push({ ingredientId: mii.ingredientId, quantity: mii.quantity, unit: mii.unit });
  }

  const sopConsumedMap = new Map<number, number>();
  for (const bill of bills) {
    for (const item of bill.items) {
      if (!item.menuItemId) continue;
      for (const mii of miiMap.get(item.menuItemId) || []) {
        const convertedQty = convertQtyToIngredientUnit(
          mii.quantity,
          mii.unit,
          ingredientUnitMap.get(mii.ingredientId),
        );
        sopConsumedMap.set(mii.ingredientId, (sopConsumedMap.get(mii.ingredientId) || 0) + item.quantity * convertedQty);
      }
    }
  }

  // Check if audit already exists for this date
  const existingAudits = await prisma.dailyStockAudit.findMany({
    where: { branchId, auditDate: dayStart },
    select: { ingredientId: true, closingQty: true, notes: true },
  });
  const existingMap = new Map(existingAudits.map((a) => [a.ingredientId, a]));

  return ingredients.map((ing) => {
    const openingQty = prevClosingMap.has(ing.id) ? prevClosingMap.get(ing.id)! : (ing.quantity || 0);
    const sopConsumed = Math.round((sopConsumedMap.get(ing.id) || 0) * 1000) / 1000;
    const expectedClosing = Math.max(0, openingQty - sopConsumed);
    const existing = existingMap.get(ing.id);
    return {
      ingredientId: ing.id,
      name: ing.name,
      unit: ing.unit || "units",
      pricePerUnit: ing.pricePerUnit || 0,
      openingQty: Math.round(openingQty * 1000) / 1000,
      sopConsumed,
      expectedClosing: Math.round(expectedClosing * 1000) / 1000,
      closingQty: existing ? existing.closingQty : null, // null = not yet entered
      // Positive = wastage (used more than expected), negative = under-used.
      wastage: existing ? existing.closingQty !== null ? Math.round((expectedClosing - existing.closingQty) * 1000) / 1000 : null : null,
      notes: existing?.notes || null,
      auditSaved: !!existing,
    };
  });
};

// ─── saveDailyAuditService ───────────────────────────────────────────────────
// Saves closing qty entries for a given date. Upserts one row per ingredient.
export const saveDailyAuditService = async (
  restaurantId: number,
  branchId: number,
  date: string, // "YYYY-MM-DD"
  entries: { ingredientId: number; closingQty: number; openingQty: number; sopConsumed: number; notes?: string }[],
) => {
  const auditDate = new Date(date + "T00:00:00.000Z");

  const rows = entries.map((e) => {
    // Positive = wastage (used more than expected), negative = under-used.
    const wastage = (e.openingQty - e.sopConsumed) - e.closingQty;
    return {
      restaurantId,
      branchId,
      ingredientId: e.ingredientId,
      auditDate,
      openingQty: e.openingQty,
      sopConsumed: e.sopConsumed,
      closingQty: e.closingQty,
      wastage: Math.round(wastage * 1000) / 1000,
      notes: e.notes || null,
    };
  });

  // Upsert each row
  await Promise.all(
    rows.map((row) =>
      prisma.dailyStockAudit.upsert({
        where: { branchId_ingredientId_auditDate: { branchId, ingredientId: row.ingredientId, auditDate } },
        update: { closingQty: row.closingQty, wastage: row.wastage, notes: row.notes, updatedAt: new Date() },
        create: row,
      }),
    ),
  );

  return { saved: rows.length };
};

// ─── getDailyAuditHistoryService ─────────────────────────────────────────────
export const getDailyAuditHistoryService = async (
  branchId: number,
  from: string,
  to: string,
) => {
  return prisma.dailyStockAudit.findMany({
    where: {
      branchId,
      auditDate: { gte: new Date(from + "T00:00:00.000Z"), lte: new Date(to + "T23:59:59.999Z") },
    },
    include: { ingredient: { select: { id: true, name: true, unit: true, pricePerUnit: true } } },
    orderBy: [{ auditDate: "desc" }, { ingredient: { name: "asc" } }],
  });
};

// ─── getIngredientLifecycleService ───────────────────────────────────────────
export const getIngredientLifecycleService = async (
  restaurantId: number,
  branchId: number,
  month: number,
  year: number,
) => {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);

  const [restock, adjustments, ingredients] = await Promise.all([
    prisma.inventoryRestock.findFirst({ where: { restaurantId, branchId, month, year } }),
    prisma.inventoryAdjustment.findMany({
      where: { branchId, createdAt: { gte: startDate, lte: endDate } },
      include: {
        ingredient: { select: { id: true, name: true, unit: true } },
        updatedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.ingredient.findMany({
      where: { restaurantId },
      select: { id: true, name: true, unit: true, quantity: true, pricePerUnit: true },
    }),
  ]);

  const bills = await prisma.bill.findMany({
    where: { restaurantId, branchId, status: "PAID", createdAt: { gte: startDate, lte: endDate } },
    select: { items: { select: { menuItemId: true, itemName: true, quantity: true } } },
  });

  const menuItemIds = [
    ...new Set(
      bills.flatMap((b) => b.items.filter((i) => i.menuItemId).map((i) => i.menuItemId!)),
    ),
  ];

  const menuItemIngredients =
    menuItemIds.length > 0
      ? await prisma.menuItemIngredient.findMany({
          where: { menuItemId: { in: menuItemIds } },
          include: { menuItem: { select: { id: true, name: true } } },
        })
      : [];

  const ingredientByName = new Map(ingredients.map((i) => [i.name.toLowerCase().trim(), i]));
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]));

  // Parse restock JSON: { week1: [{Ingredient, "Opening Qty", "Week Purchase", "Closing Qty"}...], week2: [...] }
  const restockData = restock?.data as Record<string, any[]> | null;
  const restockByName = new Map<
    string,
    { openingQty: number; purchases: number; closingQty: number; unit: string }
  >();

  if (restockData) {
    const weekKeys = Object.keys(restockData).sort();
    for (const wk of weekKeys) {
      for (const row of restockData[wk] || []) {
        const name = String(row["Ingredient"] || "").toLowerCase().trim();
        if (!name) continue;
        if (!restockByName.has(name))
          restockByName.set(name, { openingQty: 0, purchases: 0, closingQty: 0, unit: row["Unit"] || "" });
      }
    }
    for (const row of restockData[weekKeys[0]] || []) {
      const name = String(row["Ingredient"] || "").toLowerCase().trim();
      if (restockByName.has(name)) restockByName.get(name)!.openingQty = Number(row["Opening Qty"] || 0);
    }
    for (const wk of weekKeys) {
      for (const row of restockData[wk] || []) {
        const name = String(row["Ingredient"] || "").toLowerCase().trim();
        if (restockByName.has(name)) restockByName.get(name)!.purchases += Number(row["Week Purchase"] || 0);
      }
    }
    for (const row of restockData[weekKeys[weekKeys.length - 1]] || []) {
      const name = String(row["Ingredient"] || "").toLowerCase().trim();
      if (restockByName.has(name)) restockByName.get(name)!.closingQty = Number(row["Closing Qty"] || 0);
    }
  }

  // Build menuItemId → ingredient usage map
  const miiMap = new Map<number, { ingredientId: number; quantity: number; unit: string | null; dishName: string }[]>();
  for (const mii of menuItemIngredients) {
    if (!miiMap.has(mii.menuItemId)) miiMap.set(mii.menuItemId, []);
    miiMap.get(mii.menuItemId)!.push({
      ingredientId: mii.ingredientId,
      quantity: mii.quantity,
      unit: (mii as any).unit ?? null,
      dishName: mii.menuItem.name,
    });
  }

  // Per ingredient: dish usage breakdown
  const dishUsage = new Map<number, Map<string, { qty: number; orders: number }>>();
  for (const bill of bills) {
    for (const item of bill.items) {
      if (!item.menuItemId) continue;
      const miis = miiMap.get(item.menuItemId);
      if (!miis) continue;
      for (const mii of miis) {
        if (!dishUsage.has(mii.ingredientId)) dishUsage.set(mii.ingredientId, new Map());
        const dm = dishUsage.get(mii.ingredientId)!;
        if (!dm.has(item.itemName)) dm.set(item.itemName, { qty: 0, orders: 0 });
        const convertedQty = convertQtyToIngredientUnit(
          mii.quantity,
          mii.unit,
          ingredientById.get(mii.ingredientId)?.unit,
        );
        dm.get(item.itemName)!.qty += item.quantity * convertedQty;
        dm.get(item.itemName)!.orders += item.quantity;
      }
    }
  }

  // Per ingredient: adjustments — SALE_DEDUCTION rows are routine per-sale
  // stock decrements auto-logged on every paid bill, not wastage, so they're
  // excluded from the wastage-log/unaccounted-wastage math below.
  const adjByIngredient = new Map<number, any[]>();
  for (const adj of adjustments) {
    if (adj.adjustmentType === "SALE_DEDUCTION") continue;
    if (!adjByIngredient.has(adj.ingredientId)) adjByIngredient.set(adj.ingredientId, []);
    adjByIngredient.get(adj.ingredientId)!.push({
      type: adj.adjustmentType,
      qty: Number(adj.quantity),
      reason: adj.reason,
      date: adj.createdAt,
      by: adj.updatedBy?.name || null,
    });
  }

  // Collect all ingredient IDs with any data
  const allIngIds = new Set<number>([...dishUsage.keys(), ...adjByIngredient.keys()]);
  for (const [name] of restockByName) {
    const ing = ingredientByName.get(name);
    if (ing) allIngIds.add(ing.id);
  }

  const result = [];
  for (const ingId of allIngIds) {
    const ing = ingredientById.get(ingId);
    if (!ing) continue;

    const rs = restockByName.get(ing.name.toLowerCase().trim()) || {
      openingQty: 0,
      purchases: 0,
      closingQty: 0,
      unit: "",
    };
    const available = rs.openingQty + rs.purchases;
    const consumed = Math.max(0, available - rs.closingQty);

    const dm = dishUsage.get(ingId);
    const usedInDishes = dm ? [...dm.values()].reduce((s, v) => s + v.qty, 0) : 0;
    const usedInDishesByDish = dm
      ? [...dm.entries()]
          .map(([dishName, v]) => ({ dishName, qty: v.qty, orders: v.orders }))
          .sort((a, b) => b.qty - a.qty)
      : [];

    const adjEntries = adjByIngredient.get(ingId) || [];
    const loggedWastage = adjEntries.reduce((s: number, a: any) => s + a.qty, 0);

    // Formula 3: Wastage = Opening + Purchases − Closing − Expected Consumption
    // Positive = wastage (used more than expected), negative = under-used.
    const wastageQty = consumed - usedInDishes;
    // Formula 1: Wastage % = (Wastage Qty / Total Received) × 100
    const wastagePercentage = available > 0 ? Math.round((wastageQty / available) * 10000) / 100 : 0;
    // Formula 2: Wastage Cost = Wastage Qty × Unit Cost
    const pricePerUnit = (ing as any).pricePerUnit || 0;
    const wastageCost = Math.round(wastageQty * pricePerUnit * 100) / 100;
    // Unaccounted = Wastage not explained by logged entries
    const unaccountedWastage = Math.max(0, wastageQty - loggedWastage);

    result.push({
      ingredientId: ingId,
      name: ing.name,
      unit: ing.unit || rs.unit || "units",
      pricePerUnit,
      currentStock: ing.quantity || 0,
      openingQty: rs.openingQty,
      purchases: rs.purchases,
      available,
      closingQty: rs.closingQty,
      consumed: Math.round(consumed * 1000) / 1000,
      expectedConsumption: Math.round(usedInDishes * 1000) / 1000,
      usedInDishesByDish,
      wastageQty: Math.round(wastageQty * 1000) / 1000,
      wastagePercentage,
      wastageCost,
      loggedWastage: Math.round(loggedWastage * 1000) / 1000,
      adjustmentEntries: adjEntries,
      unaccountedWastage: Math.round(unaccountedWastage * 1000) / 1000,
      hasRestockData: available > 0,
    });
  }

  return result.sort((a, b) => b.available - a.available);
};

// ─── getInventoryAdjustmentsService ──────────────────────────────────────────
export const getInventoryAdjustmentsService = async (
  branchId: number,
  from?: string,
  to?: string,
) => {
  const dateFilter =
    from && to
      ? {
          createdAt: {
            gte: new Date(from),
            lte: new Date(to + "T23:59:59.999Z"),
          },
        }
      : {};

  return prisma.inventoryAdjustment.findMany({
    where: { branchId, ...dateFilter },
    include: {
      ingredient: {
        select: { id: true, name: true, unit: true, pricePerUnit: true },
      },
      updatedBy: {
        select: { id: true, name: true, role: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
};
