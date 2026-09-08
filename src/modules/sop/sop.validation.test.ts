import { describe, expect, it } from "vitest";
import { parseBody } from "../../shared/validate";
import { createSopSchema, updateSopSchema } from "./sop.validation";

/**
 * `updateSopChecklist` spreads its `data` argument into
 * `prisma.sopChecklist.update({ data })`. Its TypeScript parameter type lists
 * five editable fields; a type annotation removes nothing at runtime, so the
 * raw body reached the database. These pin the schema that now does.
 */

describe("updateSopSchema — the tenant-reassignment hole", () => {
  it("strips a client-supplied restaurantId", () => {
    const parsed = parseBody(updateSopSchema, { title: "Close the till", restaurantId: 42 });
    expect(parsed).not.toHaveProperty("restaurantId");
    expect(parsed.title).toBe("Close the till");
  });

  it("strips any other column the endpoint never meant to accept", () => {
    const parsed = parseBody(updateSopSchema, { title: "X", id: 9, branchId: 3, createdAt: "2020-01-01" });
    expect(Object.keys(parsed)).toEqual(["title"]);
  });

  it("keeps the five fields the endpoint does edit", () => {
    const parsed = parseBody(updateSopSchema, {
      title: "Open the kitchen",
      category: "Opening",
      steps: ["Unlock", "Check temps"],
      menuItemId: 12,
      isActive: false,
    });
    expect(parsed.steps).toEqual(["Unlock", "Check temps"]);
    expect(parsed.isActive).toBe(false);
    expect(parsed.menuItemId).toBe(12);
  });

  it("allows menuItemId to be cleared", () => {
    expect(parseBody(updateSopSchema, { menuItemId: null }).menuItemId).toBeNull();
  });

  it("refuses an empty update rather than issuing a no-op write", () => {
    expect(() => parseBody(updateSopSchema, {})).toThrow(/at least one field/i);
  });
});

describe("createSopSchema", () => {
  it("also refuses a client-supplied restaurantId", () => {
    const parsed = parseBody(createSopSchema, {
      title: "Close",
      steps: ["a"],
      restaurantId: 42,
    });
    expect(parsed).not.toHaveProperty("restaurantId");
  });

  it("requires a title and at least one step", () => {
    expect(() => parseBody(createSopSchema, { steps: ["a"] })).toThrow();
    expect(() => parseBody(createSopSchema, { title: "X", steps: [] })).toThrow(/at least one step/i);
  });

  it("rejects an empty step, which would render as a blank checklist row", () => {
    expect(() => parseBody(createSopSchema, { title: "X", steps: ["ok", "   "] })).toThrow();
  });

  it("bounds the step count so a paste accident cannot store a novel", () => {
    const tooMany = Array.from({ length: 101 }, (_, i) => `step ${i}`);
    expect(() => parseBody(createSopSchema, { title: "X", steps: tooMany })).toThrow(/too many/i);
  });
});
