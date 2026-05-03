import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import axios from "axios";

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const LOG_PATH = path.join(DATA_DIR, "webhook_logs.json");
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

// ======================
// Ensure folders exist
// ======================
[DATA_DIR, UPLOADS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ======================
// Initial DB
// ======================
const INITIAL_DB = {
  orders: [],
  settings: {
    pathao_webhook_secret:
      process.env.PATHAO_WEBHOOK_SECRET ||
      "40489fe0-9386-4fc9-8e92-2b2fcb9d451c",

    carrybee_webhook_secret:
      process.env.CARRYBEE_WEBHOOK_SECRET ||
      "40489fe0-9386-4fc9-8e92-2b2fcb9d451c",
  },
};

// ======================
// DB FUNCTIONS
// ======================
function getDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify(INITIAL_DB, null, 2));
    }

    const raw = fs.readFileSync(DB_PATH, "utf-8");

    if (!raw || raw.trim() === "") {
      fs.writeFileSync(DB_PATH, JSON.stringify(INITIAL_DB, null, 2));
      return INITIAL_DB;
    }

    const db = JSON.parse(raw);

    if (!db.orders) db.orders = [];
    if (!db.settings) db.settings = INITIAL_DB.settings;

    return db;
  } catch (e) {
    console.error("DB ERROR:", e);

    fs.writeFileSync(DB_PATH, JSON.stringify(INITIAL_DB, null, 2));

    return INITIAL_DB;
  }
}

function saveDB(db: any) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ======================
// LOGS
// ======================
function getLogs() {
  if (!fs.existsSync(LOG_PATH)) {
    fs.writeFileSync(LOG_PATH, JSON.stringify([], null, 2));
  }

  return JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
}

function saveLog(log: any) {
  const logs = getLogs();

  logs.unshift({
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    ...log,
  });

  fs.writeFileSync(LOG_PATH, JSON.stringify(logs.slice(0, 1000), null, 2));
}

// ======================
// UPSERT ORDER
// ======================
function upsertOrder(db: any, update: any) {
  const index = db.orders.findIndex(
    (o: any) =>
      o.consignment_id === update.consignment_id ||
      o.tracking_id === update.tracking_id ||
      o.tracking_id === update.consignment_id
  );

  if (index > -1) {
    db.orders[index] = {
      ...db.orders[index],
      ...update,
      last_webhook_update: new Date().toISOString(),
    };
  } else {
    db.orders.push({
      ...update,
      created_at: new Date().toISOString(),
      last_webhook_update: new Date().toISOString(),
    });
  }
}

// ======================
// SERVER START
// ======================
async function startServer() {
  const app = express();

  app.use(express.json());

  const upload = multer({
    dest: UPLOADS_DIR,
  });

  // ======================
  // INFO
  // ======================
  app.get("/api/info", (req, res) => {
    res.json({
      appUrl: process.env.APP_URL || `http://localhost:${PORT}`,
    });
  });

  // ======================
  // SETTINGS
  // ======================
  app.get("/api/settings", (req, res) => {
    const db = getDB();
    res.json(db.settings);
  });

  app.post("/api/settings", (req, res) => {
    const db = getDB();

    db.settings = {
      ...db.settings,
      ...req.body,
    };

    saveDB(db);

    res.json({
      success: true,
      message: "Settings updated",
    });
  });

  // ======================
  // ORDERS
  // ======================
  app.get("/api/orders", (req, res) => {
    const db = getDB();
    res.json(db.orders);
  });

  // ======================
  // LOGS
  // ======================
  app.get("/api/logs", (req, res) => {
    res.json(getLogs());
  });

  // ======================
  // CLEAR DATABASE
  // ======================
  app.post("/api/clear-all", (req, res) => {
    const db = getDB();

    db.orders = [];

    saveDB(db);

    res.json({
      success: true,
      message: "Database cleared",
    });
  });

  // ======================
  // CSV SAMPLE DOWNLOAD
  // ======================
  app.get("/api/sample-csv", (req, res) => {
    const csvPath = path.join(process.cwd(), "sample.csv");

    if (!fs.existsSync(csvPath)) {
      return res.status(404).send("Sample CSV not found");
    }

    res.download(csvPath, "sample_fleettrack.csv", (err) => {
      if (err) {
        console.error(err);
      }
    });
  });

  // ======================
  // CSV EXPORT
  // ======================
  app.get("/api/export", (req, res) => {
    const db = getDB();

    const csv = stringify(db.orders, {
      header: true,
    });

    res.setHeader("Content-Type", "text/csv");

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=orders_export.csv"
    );

    res.send(csv);
  });

  // ======================
  // CSV IMPORT
  // ======================
  app.post("/api/upload", upload.single("file"), (req, res) => {
    try {
      if (!(req as any).file) {
        return res.status(400).json({
          error: "No file uploaded",
        });
      }

      const content = fs.readFileSync((req as any).file.path, "utf-8");

      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      const db = getDB();

      records.forEach((r: any) => {
        upsertOrder(db, {
          tracking_id: r.tracking_id || "",
          consignment_id: r.consignment_id || "",
          courier_name: r.courier_name || "",
          status: "Pending",
          status_timestamp: new Date().toISOString(),
        });
      });

      saveDB(db);

      fs.unlinkSync((req as any).file.path);

      res.json({
        success: true,
        count: records.length,
        message: `${records.length} orders imported`,
      });
    } catch (e: any) {
      res.status(500).json({
        error: e.message,
      });
    }
  });

  // ======================
  // TEST WEBHOOK
  // ======================
  app.post("/api/test-webhook", async (req, res) => {
    try {
      const { courier, consignment_id } = req.body;

      const db = getDB();

      if (courier === "Pathao") {
        await axios.post(
          `http://localhost:${PORT}/webhooks/pathao`,
          {
            event: "order.delivered",
            consignment_id,
            merchant_order_id: consignment_id,
            timestamp: new Date().toISOString(),
          },
          {
            headers: {
              "X-Pathao-Merchant-Webhook-Integration-Secret":
                db.settings.pathao_webhook_secret,
            },
          }
        );
      } else {
        await axios.post(
          `http://localhost:${PORT}/webhooks/carrybee`,
          {
            consignment_id,
            status: "Delivered",
          },
          {
            headers: {
              "X-CB-Webhook-Integration-Header":
                db.settings.carrybee_webhook_secret,
            },
          }
        );
      }

      res.json({
        success: true,
        message: "Webhook test successful",
      });
    } catch (e: any) {
      res.status(500).json({
        error: e.message,
      });
    }
  });

  // ======================
  // PATHAO WEBHOOK
  // ======================
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

        saveLog({
          courier: "Pathao",
          payload,
        });

        if (payload.event === "webhook_integration") {
          saveLog({
            courier: "Pathao",
            message: "Webhook verified",
          });

          return;
        }

        const eventMap: Record<string, string> = {
          "order.delivered": "Delivered",
          "order.partial_delivered": "Partial Delivered",
          "order.returned": "Returned",
          "order.cancelled": "Failed",
          "order.in_transit": "On the way",
          "order.picked_up": "Processing",
          "order.assigned_for_delivery": "On the way",
          "order.received_at_hub": "Processing",
          "order.on_hold": "On Hold",
        };

        const status =
          eventMap[payload.event] || payload.order_status || "Updated";

        const db2 = getDB();

        upsertOrder(db2, {
          tracking_id:
            payload.merchant_order_id ||
            payload.consignment_id,

          consignment_id: payload.consignment_id,

          courier_name: "Pathao",

          status,

          status_timestamp:
            payload.timestamp ||
            payload.updated_at ||
            new Date().toISOString(),

          collected_amount:
            payload.collected_amount || 0,
        });

        saveDB(db2);

        saveLog({
          courier: "Pathao",
          message: `UPDATED → ${payload.consignment_id} = ${status}`,
        });
      } catch (e: any) {
        saveLog({
          courier: "Pathao",
          error: e.message,
        });
      }
    });
  });

  // ======================
  // CARRYBEE WEBHOOK
  // ======================
  app.post("/webhooks/carrybee", (req, res) => {
    const db = getDB();

    const secret = db.settings.carrybee_webhook_secret;

    res.setHeader(
      "X-CB-Webhook-Integration-Header",
      secret
    );

    res.status(202).end("Accepted");

    setImmediate(() => {
      try {
        const payload = req.body;

        saveLog({
          courier: "CarryBee",
          payload,
        });

        const statusMap: Record<string, string> = {
          Delivered: "Delivered",
          Returned: "Returned",
          Processing: "Processing",
          "In Transit": "On the way",
        };

        const status =
          statusMap[payload.status] ||
          payload.status ||
          "Updated";

        const db2 = getDB();

        upsertOrder(db2, {
          tracking_id: payload.consignment_id,

          consignment_id: payload.consignment_id,

          courier_name: "CarryBee",

          status,

          status_timestamp: new Date().toISOString(),
        });

        saveDB(db2);

        saveLog({
          courier: "CarryBee",
          message: `UPDATED → ${payload.consignment_id} = ${status}`,
        });
      } catch (e: any) {
        saveLog({
          courier: "CarryBee",
          error: e.message,
        });
      }
    });
  });

  // ======================
  // FRONTEND
  // ======================
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
      },
      appType: "spa",
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");

    app.use(express.static(distPath));

    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // ======================
  // START SERVER
  // ======================
  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

startServer();
