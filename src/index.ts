import express from "express";

import compression from "compression";

import cors from "cors";

import helmet from "helmet";

import path from "path";

import routes from "./routes";
import { corsOptions } from "./config/cors";
import { globalRateLimiter } from "./middleware/rateLimit";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

const app = express();

// Behind a proxy (Render/Nginx/ELB) req.ip is the proxy's address unless this
// is set, which would make every rate-limit bucket and every audited IP the
// same value for all callers.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));

// Security headers. `contentSecurityPolicy` is left at helmet's default (which
// is restrictive) because this process serves JSON and static uploads, never
// an HTML app — the frontends are deployed separately.
app.use(
  helmet({
    // The uploads directory is read cross-origin by the restaurant apps, so the
    // default same-origin resource policy would block every menu image.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(cors(corsOptions));

// A coarse ceiling for the whole API. Tighter, per-route limits are applied to
// the sensitive internal endpoints (see modules/internal/rbac/rateLimit).
app.use(globalRateLimiter);

// Analytics and report responses are large, highly repetitive JSON and were
// being sent uncompressed across the Singapore→India hop. gzip typically takes
// 80–90% off those payloads. Registered before the routes so every JSON
// response is covered; `threshold` skips the tiny ones where the CPU cost of
// compressing outweighs the saving.
app.use(compression({ threshold: 1024 }));

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true,
  }),
);

app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.use("/api", routes);

app.get("/", (_req, res) => {
  res.send("DineInk Backend Running 🚀");
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
