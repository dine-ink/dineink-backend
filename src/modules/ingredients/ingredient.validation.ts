import { z, idField, shortText } from "../../shared/validate";

/**
 * Vendor input.
 *
 * `updateVendorHandler` passed `req.body` straight into
 * `prisma.vendor.update({ where: { id }, data })`. The service's parameter type
 * lists five editable fields, but a TypeScript annotation removes nothing at
 * runtime — so `PUT /api/ingredients/vendors/:id` with `{"restaurantId": 42}`
 * moved another restaurant's vendor under the caller. The ownership check in
 * the service passes, because it validates the row being edited, not the fields
 * being written. Identical in shape to the SOP checklist bug.
 *
 * This is not hypothetical input: owner-web's vendor form posts
 * `{ ...vendorForm, restaurantId, branchId }` for both create and update. A zod
 * object strips unknown keys, so leaving `restaurantId` out of the schema drops
 * it silently — the existing client keeps working unchanged, while a
 * client-supplied tenant id stops reaching the database.
 */

const vendorFields = {
  name: shortText(200),
  address: z.string().trim().max(500).optional(),
  phone: z.string().trim().max(32).optional(),
  email: z.string().trim().email("Enter a valid email address.").max(254).optional().or(z.literal("")),
  vendorType: z.string().trim().max(100).optional(),
  // Kept, because the vendor form genuinely sets it — but the service checks it
  // belongs to the caller's restaurant before writing. A branch id is just an
  // integer; nothing else stops it naming another tenant's branch.
  branchId: idField.optional(),
};

// restaurantId is deliberately absent from both: the controller supplies the
// caller's own from the JWT, and accepting one here is the hole itself.
export const createVendorSchema = z.object(vendorFields);

export const updateVendorSchema = z
  .object({
    ...vendorFields,
    name: shortText(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

/**
 * `POST /price-update` — records a new unit price for an ingredient.
 *
 * `changedById` is deliberately absent. The service writes it to
 * IngredientPriceHistory as the person who made the change, and the controller
 * spread it in from the request body — so a caller could attribute their own
 * price change to a colleague. It now comes from the JWT, and omitting it here
 * is what stops a body-supplied one from overriding that.
 */
export const priceUpdateSchema = z.object({
  ingredientId: idField,
  newPrice: z.coerce
    .number()
    .nonnegative("A price cannot be negative.")
    .max(9_999_999, "That price is too large."),
});
