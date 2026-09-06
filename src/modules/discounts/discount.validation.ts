import { z, moneyField } from "../../shared/validate";

/**
 * Discount code input.
 *
 * The service hand-checked three of these fields and coerced the rest with
 * `Number(...)`, which turns a missing or non-numeric `maxUses` into `NaN` on
 * the way to an Int column. The percentage bound is the one worth stating
 * explicitly: a PERCENTAGE code above 100 is a bill that pays the customer.
 */

const codeField = z
  .string()
  .trim()
  .min(1, "Enter a code.")
  .max(32, "A code can be at most 32 characters.")
  .regex(/^[A-Za-z0-9_-]+$/, "A code can only contain letters, numbers, hyphens and underscores.")
  .transform((value) => value.toUpperCase());

const expiryField = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid expiry date.")
  .nullable()
  .optional();

export const createDiscountSchema = z
  .object({
    code: codeField,
    type: z.enum(["PERCENTAGE", "FIXED"], {
      message: "Type must be PERCENTAGE or FIXED.",
    }),
    value: z.coerce.number().positive("Value must be greater than 0."),
    maxUses: z.coerce.number().int().positive().nullable().optional(),
    expiresAt: expiryField,
  })
  .refine((input) => input.type !== "PERCENTAGE" || input.value <= 100, {
    message: "A percentage discount cannot be more than 100%.",
    path: ["value"],
  });

/**
 * `code` and `type` are absent by design — the service does not update them,
 * and the unique constraint is on (restaurantId, code), so letting a code be
 * renamed here would need conflict handling that does not exist.
 */
export const updateDiscountSchema = z
  .object({
    isActive: z.boolean().optional(),
    value: z.coerce.number().positive("Value must be greater than 0.").optional(),
    maxUses: z.coerce.number().int().positive().nullable().optional(),
    expiresAt: expiryField,
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

export const validateDiscountSchema = z.object({
  code: codeField,
  subtotal: moneyField,
});
