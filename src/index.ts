import express from "express";

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
