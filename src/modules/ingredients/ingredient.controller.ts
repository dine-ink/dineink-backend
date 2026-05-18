import * as ingredientService from "./ingredient.service";

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
    const { restaurantId, ingredients } = req.body;
    const data = await ingredientService.saveIngredients(
      restaurantId,
      ingredients,
    );
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    console.log(err);
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
    const data = await ingredientService.aiSuggestMappingData(req.body);
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
