import dotenv from "dotenv";

dotenv.config();

import { assertSecretsConfigured } from "./config/secrets";
import app from "./index";

// Before anything listens. A process that boots, goes green, and only fails
// when someone tries to sign in is worse than one that refuses to start.
assertSecretsConfigured();

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
