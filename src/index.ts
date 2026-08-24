import express from "express";

import compression from "compression";

import cors from "cors";

import path from "path";

import routes from "./routes";

const app = express();

app.use(cors({
  origin: (origin, callback) => {
    callback(null, true);
  },
  credentials: true,
}));

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

app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack || err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

export default app;
