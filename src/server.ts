import dotenv from "dotenv";

dotenv.config();

import app from "./index";

const PORT = Number(process.env.PORT) || 5500;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

process.on("uncaughtException", (err) => {
  console.error("🔥 UNCAUGHT ERROR:", err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error("🔥 UNHANDLED REJECTION:", err);
  process.exit(1);
});
