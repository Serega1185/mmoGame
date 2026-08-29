import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { createServer } from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer as createVite } from "vite";
import { CONFIG } from "./config.ts";
import { seedIfEmpty } from "./seed/run.ts";
import { flattenToOneCell, reflowInventories } from "./engine/inventory.ts";
import { authOptional } from "./auth.ts";
import { api } from "./routes/api.ts";
import { attachWs } from "./wsHub.ts";
import { expireAuctions } from "./game.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

seedIfEmpty();
flattenToOneCell();
reflowInventories();
expireAuctions();
setInterval(expireAuctions, 30_000);

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(authOptional);
app.use("/api", api);
app.use("/assets", express.static(path.join(root, "assets")));

const httpServer = createServer(app);
attachWs(httpServer);

const isProd = process.env.NODE_ENV === "production" || fs.existsSync(path.join(root, "dist", "index.html"));

async function start() {
  if (isProd && fs.existsSync(path.join(root, "dist", "index.html"))) {
    app.use(express.static(path.join(root, "dist")));
    app.get("*", (_req, res) => res.sendFile(path.join(root, "dist", "index.html")));
  } else {
    const vite = await createVite({
      configFile: path.join(root, "vite.config.ts"),
      server: {
        middlewareMode: true,
        hmr: { server: httpServer, port: CONFIG.PORT, clientPort: CONFIG.PORT },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }
  httpServer.listen(CONFIG.PORT, "0.0.0.0", () => {
    console.log(`Ashmarch holds the gate on http://127.0.0.1:${CONFIG.PORT}`);
  });
}

start();
