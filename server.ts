import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import multer from "multer";
import axios from "axios";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const PORT = Number(process.env.PORT || 3000);

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const LOG_PATH = path.join(DATA_DIR, "webhook_logs.json");
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

// ================================
// INIT FOLDERS
// ================================
[DATA_DIR, UPLOADS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ================================
// INITIAL DB
// ================================
const INITIAL_DB = {
  orders: [],
  settings: {
    pathao_webhook_secret:
      process.env.PATHAO_WEBHOOK_SECRET ||
      "f3992ecc-59da-4cbe-a049-a13da2018d51",

    carrybee_webhook_secret:
      process.env.CARRYBEE_WEBHOOK_SECRET ||
      "40489fe0-9386-4fc9-8e92-2b2fcb9d451c",
  },
};

// ================================
// DB
// ================================
function getDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify(INITIAL_DB, null, 2));
    }

    const raw = fs.readFileSync(DB_PATH, "utf-8");
    return JSON.parse(raw || JSON.stringify(INITIAL_DB));
  } catch {
    return INITIAL_DB;
  }
}

function saveDB(db: any) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ================================
// LOGS
// ================================
function getLogs() {
  if (!fs.existsSync(LOG_PATH)) fs.writeFileSync(LOG_PATH, "[]");
  return JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
}

function saveLog(log: any) {
  const logs = getLogs();
  logs.unshift({ id: Date.now().toString(), ...log, timestamp: new Date().toISOString() });
  fs.writeFileSync(LOG_PATH, JSON.stringify(logs.slice(0, 1000), null, 2));
}

// ================================
// DUPLICATE PROTECTION
// ================================
const processed = new Set<string>();

// ================================
// UPSERT
// ================================
function upsert(db: any, data: any) {
  const i = db.orders.findIndex(
    (o: any) =>
      o.consignment_id === data.consignment_id ||
      o.tracking_id === data.tracking_id
  );

  if (i > -1) db.orders[i] = { ...db.orders[i], ...data };
  else db.orders.push(data);
}

// ================================
// APP
// ================================
async function start() {
  const app = express();
  app.use(express.json());

  const upload = multer({ dest: UPLOADS_DIR });

  // ================================
  // SETTINGS
  // ================================
  app.get("/api/settings", (req, res) => {
    res.json(getDB().settings);
  });

  app.post("/api/settings", (req, res) => {
    const db = getDB();
    db.settings = { ...db.settings, ...req.body };
    saveDB(db);
    res.json({ success: true });
  });

  // ================================
  // ORDERS
  // ================================
  app.get("/api/orders", (req, res) => {
    res.json(getDB().orders);
  });

  // ================================
  // LOGS
  // ================================
  app.get("/api/logs", (req, res) => {
    res.json(getLogs());
  });

  // ================================
  // CSV UPLOAD
  // ================================
  app.post("/api/upload", upload.single("file"), (req, res) => {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: "No file" });

    const content = fs.readFileSync(file.path, "utf-8");
    const records = parse(content, { columns: true, skip_empty_lines: true });

    const db = getDB();

    records.forEach((r: any) => {
      upsert(db, {
        tracking_id: r.tracking_id,
        consignment_id: r.consignment_id,
        courier_name: r.courier_name,
        status: "Pending",
        status_timestamp: new Date().toISOString(),
      });
    });

    saveDB(db);
    fs.unlinkSync(file.path);

    res.json({ success: true, count: records.length });
  });

  // ================================
  // REAL PATHAO BULK FETCH
  // ================================
  app.post("/api/bulk-fetch", async (req, res) => {
    try {
      const db = getDB();

      // NOTE: replace with real token API if available
      const token = process.env.PATHAO_TOKEN || "";

      let updated = 0;

      for (const order of db.orders) {
        if (order.courier_name !== "Pathao") continue;

        try {
          const resp = await axios.get(
            `https://api-hermes.pathao.com/aladdin/api/v1/orders/${order.consignment_id}/info`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );

          const data = resp.data?.data;
          if (!data) continue;

          const status = data.order_status || "Processing";

          if (order.status !== status) {
            order.status = status;
            order.status_timestamp = new Date().toISOString();
            updated++;
          }
        } catch {}
      }

      saveDB(db);

      res.json({ success: true, updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ================================
  // PATHAO WEBHOOK (REALTIME FIXED)
  // ================================
  app.post("/webhooks/pathao", (req, res) => {
    const db = getDB();
    const secret = db.settings.pathao_webhook_secret;

    res.setHeader("X-Pathao-Merchant-Webhook-Integration-Secret", secret);
    res.status(202).end("Accepted");

    setImmediate(() => {
      const payload = req.body;

      const key = payload.consignment_id + payload.event;
      if (processed.has(key)) return;
      processed.add(key);

      const map: any = {
        "order.delivered": "Delivered",
        "order.returned": "Returned",
        "order.on_hold": "On Hold",
        "order.in_transit": "On the way",
      };

      const status = map[payload.event] || "Updated";

      const db2 = getDB();

      upsert(db2, {
        tracking_id: payload.merchant_order_id,
        consignment_id: payload.consignment_id,
        courier_name: "Pathao",
        status,
        status_timestamp: new Date().toISOString(),
      });

      saveDB(db2);

      saveLog({ courier: "Pathao", message: `UPDATED ${status}` });
    });
  });

  // ================================
  // FRONTEND FIX (BLANK PAGE FIX)
  // ================================
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });

    app.use(vite.middlewares);
  } else {
    const dist = path.join(process.cwd(), "dist");

    app.use(express.static(dist));

    app.get("*", (req, res) => {
      const file = path.join(dist, "index.html");
      if (fs.existsSync(file)) res.sendFile(file);
      else res.status(500).send("Build missing");
    });
  }

  // ================================
  app.listen(PORT, "0.0.0.0", () => {
    console.log("Server running on", PORT);
  });
}

start();
