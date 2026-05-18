import express from "express";

import cors from "cors";

import path from "path";

import routes from "./routes";

const app = express();

app.use(cors());

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

export default app;
