import express from "express";
import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { guardIdParams, isValidId } from "./routeParams";
import { errorHandler } from "./errorHandler";

describe("isValidId", () => {
  it("accepts a plain positive integer", () => {
    expect(isValidId("1")).toBe(true);
    expect(isValidId("248")).toBe(true);
    expect(isValidId("2147483647")).toBe(true);
  });

  it("rejects anything that isn't digits", () => {
    expect(isValidId("abc")).toBe(false);
    expect(isValidId("")).toBe(false);
    expect(isValidId("12a")).toBe(false);
    expect(isValidId("1.5")).toBe(false);
  });

  it("rejects values that coerce to a number but are not ids", () => {
    // All of these pass a naive `Number(value)` check, which is what the
    // handlers were doing before the guard existed.
    expect(isValidId("+1")).toBe(false);
    expect(isValidId(" 1")).toBe(false);
    expect(isValidId("1e3")).toBe(false);
    expect(isValidId("0x10")).toBe(false);
  });

  it("rejects zero and negatives — no row has id 0", () => {
    expect(isValidId("0")).toBe(false);
    expect(isValidId("-1")).toBe(false);
  });

  it("rejects anything Postgres `integer` cannot hold", () => {
    // 2147483648 is one past int4. Left unchecked this reached the driver and
    // failed there, as a 500, rather than as the 400 it is.
    expect(isValidId("2147483648")).toBe(false);
    expect(isValidId("99999999999999999999")).toBe(false);
  });
});

describe("guardIdParams — through a real Express app", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const inner = express.Router();
    inner.get("/:restaurantId/items/:id", (req, res) => {
      res.json({ ok: true, params: req.params });
    });
    // A non-id param must pass through untouched.
    inner.get("/settings/:key", (req, res) => res.json({ ok: true, key: req.params.key }));

    const app = express();
    app.use("/api", guardIdParams(inner));
    app.use(errorHandler);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("lets a valid request through with its params intact", async () => {
    const res = await fetch(`${base}/api/12/items/34`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      params: { restaurantId: "12", id: "34" },
    });
  });

  it("refuses a non-numeric id with a 400 in the API's error shape", async () => {
    const res = await fetch(`${base}/api/abc/items/34`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("INVALID_ID");
    expect(body.message).toContain("restaurantId");
  });

  it("refuses an id past int4 rather than letting it reach the driver", async () => {
    const res = await fetch(`${base}/api/12/items/99999999999999999999`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_ID");
    expect(body.message).toContain("id");
  });

  it("leaves non-id params alone", async () => {
    const res = await fetch(`${base}/api/settings/currency`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, key: "currency" });
  });
});
