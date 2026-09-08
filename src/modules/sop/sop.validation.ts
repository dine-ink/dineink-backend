import { z, idField, shortText } from "../../shared/validate";

/**
 * SOP checklist input.
 *
 * `updateSopChecklist` spreads the request body straight into
 * `prisma.sopChecklist.update({ data })`. Its TypeScript parameter type lists
 * only the five editable fields, but a type annotation does not remove
 * properties at runtime — `req.body` arrives as whatever JSON was posted, so
 * `PUT /api/sop/:id` with `{"restaurantId": 42}` moved another restaurant's
 * checklist under the caller. The ownership check in the service passes,
 * because it validates the row *before* the write, not the fields being
 * written.
 *
 * A zod object strips unknown keys, so parsing here is what actually bounds the
 * update to the fields below.
 */

const stepsField = z
  .array(z.string().trim().min(1, "A step cannot be empty.").max(500))
  .min(1, "Add at least one step.")
  .max(100, "That's too many steps for one checklist.");

export const createSopSchema = z.object({
  // restaurantId is deliberately absent: the controller supplies the caller's
  // own from the JWT, and accepting one here would be the same hole again.
  branchId: idField.optional(),
  menuItemId: idField.optional(),
  title: shortText(200),
  category: z.string().trim().max(100).optional(),
  steps: stepsField,
});

export const updateSopSchema = z
  .object({
    title: shortText(200).optional(),
    category: z.string().trim().max(100).optional(),
    steps: stepsField.optional(),
    menuItemId: idField.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });
