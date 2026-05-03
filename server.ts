import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import multer from "multer";
import { parse } from "csv-parse/sync";
import axios from "axios";

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const LOG_PATH = path.join(DATA_DIR, "webhook_logs.json");
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

// Ensure folders
[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// DB init
const INITIAL_DB = {
  orders: [],
  settings: {
    pathao_webhook_secret: "f3992ecc-59da-4cbe-a049-a13da2018d51",
    carrybee_webhook_secret: "f3992ecc-59da-4cbe-a049-a13da2018d51"
  }
};

function getDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(INITIAL_DB, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function saveDB(db: any) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function saveLog(log: any) {
  const logs = fs.existsSync(LOG_PATH)
    ? JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"))
    : [];

  logs.unshift({
    ...log,
    timestamp: new Date().toISOString(),
    id: Date.now().toString()
  });

  fs.writeFileSync(LOG_PATH, JSON.stringify(logs.slice(0, 1000), null, 2));
}

// ----------------------
// 🔥 UPSERT CORE FUNCTION
// ----------------------
function upsertOrder(db: any, data: any) {
  const index = db.orders.findIndex((o: any) =>
    o.consignment_id === data.consignment_id ||
    o.tracking_id === data.tracking_id ||
    o.merchant_order_id === data.tracking_id
  );

  if (index > -1) {
    db.orders[index] = {
      ...db.orders[index],
      ...data,
      last_webhook_update: new Date().toISOString()
    };
  } else {
    db.orders.push({
      ...data,
      created_at: new Date().toISOString(),
      last_webhook_update: new Date().toISOString()
    });
  }
}

// ----------------------
// SERVER START
// ----------------------
async function startServer() {
  const app = express();
  app.use(express.json());

  const upload = multer({ dest: UPLOADS_DIR });

  // ----------------------
  // API
  // ----------------------
  app.get("/api/orders", (req, res) => {
    res.json(getDB().orders);
  });

  app.get("/api/logs", (req, res) => {
    res.json(
      fs.existsSync(LOG_PATH)
        ? JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"))
        : []
    );
  });

  app.get("/api/info", (req, res) => {
    res.json({ appUrl: `http://localhost:${PORT}` });
  });

  // ----------------------
  // TEST WEBHOOK
  // ----------------------
  app.post("/api/test-webhook", async (req, res) => {
    const { courier, consignment_id } = req.body;

    const endpoint =
      courier === "Pathao"
        ? "/webhooks/pathao"
        : "/webhooks/carrybee";

    await axios.post(`http://localhost:${PORT}${endpoint}`, {
      consignment_id,
      event: "order.delivered",
      status: "Delivered"
    });

    res.json({ message: "Test sent" });
  });

  // ----------------------
  // 🚀 CARRYBEE WEBHOOK
  // ----------------------
  app.post("/webhooks/carrybee", (req, res) => {
    const db = getDB();
    const secret = db.settings.carrybee_webhook_secret;
    const header = req.headers["x-cb-webhook-integration-header"];

    res.status(202).end("Accepted");

    setImmediate(() => {
      try {
        const payload = req.body;

        if (header !== secret) {
          saveLog({ courier: "CarryBee", error: "Invalid secret" });
          return;
        }

        const statusMap: any = {
          Delivered: "Delivered",
          Returned: "Returned",
          Processing: "Processing"
        };

        const status = statusMap[payload.status] || payload.status;

        const db2 = getDB();

        upsertOrder(db2, {
          consignment_id: payload.consignment_id,
          tracking_id: payload.consignment_id,
          courier: "CarryBee",
          status,
          timestamp: new Date().toISOString()
        });

        saveDB(db2);

        saveLog({
          courier: "CarryBee",
          message: `UPDATED → ${payload.consignment_id} = ${status}`,
          payload
        });

      } catch (e: any) {
        saveLog({ courier: "CarryBee", error: e.message });
      }
    });
  });

  // ----------------------
  // 🚀 PATHAO WEBHOOK
  // ----------------------
  app.post("/webhooks/pathao", (req, res) => {
    const db = getDB();
    const secret = db.settings.pathao_webhook_secret;

    res.setHeader(
      "X-Pathao-Merchant-Webhook-Integration-Secret",
      secret
    );

    res.status(202).end("Accepted");

    setImmediate(() => {
      try {
        const payload = req.body;

        if (payload.event === "webhook_integration") {
          saveLog({ courier: "Pathao", message: "Validated" });
          return;
        }

        const eventMap: any = {
          "order.delivered": "Delivered",
          "order.returned": "Returned",
          "order.cancelled": "Failed",
          "order.in_transit": "On the way",
          "order.picked_up": "Processing"
        };

        const status = eventMap[payload.event];
        if (!status) return;

        const db2 = getDB();

        upsertOrder(db2, {
          consignment_id: payload.consignment_id,
          tracking_id: payload.merchant_order_id,
          courier: "Pathao",
          status,
          timestamp: payload.timestamp || new Date().toISOString()
        });

        saveDB(db2);

        saveLog({
          courier: "Pathao",
          message: `UPDATED → ${payload.consignment_id} = ${status}`,
          payload
        });

      } catch (e: any) {
        saveLog({ courier: "Pathao", error: e.message });
      }
    });
  });

  // ----------------------
  // VITE (FRONTEND)
  // ----------------------
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(process.cwd(), "dist");
    app.use(express.static(dist));
    app.get("*", (req, res) => {
      res.sendFile(path.join(dist, "index.html"));
    });
  }

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

startServer();
