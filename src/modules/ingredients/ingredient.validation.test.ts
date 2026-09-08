import { describe, expect, it } from "vitest";
import { parseBody } from "../../shared/validate";
import { createVendorSchema, priceUpdateSchema, updateVendorSchema } from "./ingredient.validation";

/**
 * The vendor schemas exist for one reason: `updateVendorHandler` passed the raw
 * request body into `prisma.vendor.update({ data })`, so any column of Vendor
 * the caller named was written — `restaurantId` included. These pin the
 * behaviour that closes it.
 */

describe("updateVendorSchema — the tenant-reassignment hole", () => {
  it("strips a client-supplied restaurantId", () => {
    const parsed = parseBody(updateVendorSchema, {
      name: "Fresh Produce Co",
      restaurantId: 42,
    });

    expect(parsed).not.toHaveProperty("restaurantId");
    expect(parsed.name).toBe("Fresh Produce Co");
  });

  it("keeps working for the payload owner-web actually sends", () => {
    // The vendor form posts `{ ...vendorForm, restaurantId, branchId }` for
    // both create and update. Stripping must not break it.
    const parsed = parseBody(updateVendorSchema, {
      name: "Fresh Produce Co",
      address: "12 Market Rd",
      phone: "9876543210",
      email: "orders@fresh.example",
      vendorType: "Produce",
      restaurantId: 7,
      branchId: 3,
    });

    expect(parsed).not.toHaveProperty("restaurantId");
    expect(parsed.branchId).toBe(3);
    expect(parsed.vendorType).toBe("Produce");
  });

  it("strips any other unexpected column too, not just restaurantId", () => {
    const parsed = parseBody(updateVendorSchema, { name: "X", id: 999, createdAt: "2020-01-01" });
    expect(Object.keys(parsed)).toEqual(["name"]);
  });

  it("refuses an empty update rather than issuing a no-op write", () => {
    expect(() => parseBody(updateVendorSchema, {})).toThrow(/at least one field/i);
  });

  it("rejects a malformed email", () => {
    expect(() => parseBody(updateVendorSchema, { name: "X", email: "not-an-email" })).toThrow(
      /valid email/i,
    );
  });

  it("rejects a branchId that isn't a positive id", () => {
    expect(() => parseBody(updateVendorSchema, { name: "X", branchId: 0 })).toThrow();
    expect(() => parseBody(updateVendorSchema, { name: "X", branchId: -1 })).toThrow();
  });
});

describe("createVendorSchema", () => {
  it("also refuses a client-supplied restaurantId", () => {
    const parsed = parseBody(createVendorSchema, { name: "V", restaurantId: 42, branchId: 1 });
    expect(parsed).not.toHaveProperty("restaurantId");
  });

  it("requires a name", () => {
    expect(() => parseBody(createVendorSchema, { branchId: 1 })).toThrow();
    expect(() => parseBody(createVendorSchema, { name: "   ", branchId: 1 })).toThrow();
  });
});

describe("priceUpdateSchema", () => {
  it("strips changedById so a price change cannot be signed as someone else", () => {
    const parsed = parseBody(priceUpdateSchema, {
      ingredientId: 5,
      newPrice: 120.5,
      changedById: 99,
    });
    expect(parsed).not.toHaveProperty("changedById");
    expect(parsed.newPrice).toBe(120.5);
  });

  it("coerces the numeric strings a form actually posts", () => {
    const parsed = parseBody(priceUpdateSchema, { ingredientId: "5", newPrice: "120.5" });
    expect(parsed.ingredientId).toBe(5);
    expect(parsed.newPrice).toBe(120.5);
  });

  it("rejects a negative price", () => {
    expect(() => parseBody(priceUpdateSchema, { ingredientId: 5, newPrice: -1 })).toThrow(
      /cannot be negative/i,
    );
  });
});
