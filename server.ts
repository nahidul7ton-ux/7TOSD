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

// Ensure directories exist
[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Initial DB structure
const INITIAL_DB = {
  orders: [],
  settings: {
    pathao_client_id: "",
    pathao_client_secret: "",
    carrybee_api_key: "",
    pathao_webhook_secret: "f3992ecc-59da-4cbe-a049-a13da2018d51",
    carrybee_webhook_secret: "f3992ecc-59da-4cbe-a049-a13da2018d51",
  }
};

function getDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(INITIAL_DB, null, 2));
  }
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  // Migration for old DBs missing secrets
  if (!db.settings.pathao_webhook_secret) {
    db.settings.pathao_webhook_secret = INITIAL_DB.settings.pathao_webhook_secret;
    db.settings.carrybee_webhook_secret = INITIAL_DB.settings.carrybee_webhook_secret;
    saveDB(db);
  }
  return db;
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function getLogs() {
  if (!fs.existsSync(LOG_PATH)) {
    fs.writeFileSync(LOG_PATH, JSON.stringify([], null, 2));
  }
  return JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
}

function saveLog(log) {
  const logs = getLogs();
  logs.unshift({ ...log, timestamp: new Date().toISOString(), id: Date.now().toString() });
  fs.writeFileSync(LOG_PATH, JSON.stringify(logs.slice(0, 1000), null, 2)); // Keep last 1000
}

async function startServer() {
  const app = express();
  app.use(express.json());

  const upload = multer({ dest: UPLOADS_DIR });

  // --- API Routes ---

  // Get APP_URL info for frontend
  app.get("/api/info", (req, res) => {
    res.json({ appUrl: process.env.APP_URL || "http://localhost:3000" });
  });

  // Test Webhook Simulation
  app.post("/api/test-webhook", async (req, res) => {
    const { courier, consignment_id } = req.body;
    const db = getDB();
    const endpoint = courier === "Pathao" ? "/webhooks/pathao" : "/webhooks/carrybee";
    const secretKey = courier === "Pathao" ? "X-Pathao-Merchant-Webhook-Integration-Secret" : "X-CB-Webhook-Integration-Header";
    const secretValue = courier === "Pathao" ? db.settings.pathao_webhook_secret : db.settings.carrybee_webhook_secret;

    const payload = courier === "Pathao" 
      ? { consignment_id, status: "Delivered (Test)", tracking_number: consignment_id }
      : { consignment_id, status: "Processing (Test)" };

    try {
      // Internal call simulation
      await axios.post(`http://localhost:${PORT}${endpoint}`, payload, {
        headers: { [secretKey]: secretValue }
      });
      res.json({ message: "Test webhook dispatched" });
    } catch (e: any) {
      res.status(500).json({ error: "Test failed: " + e.message });
    }
  });

  // Auth (Simplified for demo)
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    if (username === "admin" && password === "admin123") {
      res.json({ token: "mock-jwt-token", user: { username: "admin" } });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  // Get all orders
  app.get("/api/orders", (req, res) => {
    const db = getDB();
    res.json(db.orders);
  });

  // CSV Upload
  app.post("/api/upload", upload.single("file"), (req, res) => {
    if (!(req as any).file) return res.status(400).json({ error: "No file uploaded" });

    try {
      const content = fs.readFileSync((req as any).file.path, "utf-8");
      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      const db = getDB();
      const newOrders = records.map((r: any) => ({
        id: r.tracking_id || r.consignment_id || Math.random().toString(36).substr(2, 9),
        tracking_id: r.tracking_id || "",
        consignment_id: r.consignment_id || "",
        courier_name: r.courier_name || "",
        status: "Pending",
        status_timestamp: new Date().toISOString(),
        last_webhook_update: null,
      }));

      db.orders = [...db.orders, ...newOrders];
      saveDB(db);
      
      fs.unlinkSync((req as any).file.path);
      res.json({ message: `Imported ${newOrders.length} orders`, count: newOrders.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Bulk Fetch Status
  app.post("/api/bulk-fetch", async (req, res) => {
    const db = getDB();
    const orders = db.orders;
    
    // Status mapping for normalization
    const statusMap: Record<string, string> = {
      "Received at Last Mile Hub": "Processing",
      "Assigned for Delivery": "On the way",
      "Delivered": "Delivered",
      "Partial Delivery": "Partial Delivered",
      "Return": "Returned",
      "On Hold": "On Hold",
      "Paid Return": "Returned",
      "Exchange": "Exchange"
    };

    // Check if transition is needed
    const pendingOrders = orders.filter(o => !["Delivered", "Returned", "Failed", "On Hold"].includes(o.status));
    
    res.json({ 
      message: `Started tracking sequence for ${pendingOrders.length} active consignments`,
      count: pendingOrders.length 
    });

    const CONCURRENCY = 3;
    const queue = [...pendingOrders];

    const processQueue = async () => {
      while (queue.length > 0) {
        const batch = queue.splice(0, CONCURRENCY);
        await Promise.all(batch.map(async (order) => {
          try {
            await new Promise(r => setTimeout(r, 600)); 
            
            const lifecycle: Record<string, string> = {
              "Pending": "Received at Last Mile Hub",
              "Processing": "Assigned for Delivery",
              "On the way": "Delivered",
              "Received at Last Mile Hub": "Assigned for Delivery",
              "Assigned for Delivery": "Delivered"
            };

            const rawNextStatus = lifecycle[order.status] || order.status;
            
            // Randomly simulate a failure or special state
            let finalRawStatus = rawNextStatus;
            const rand = Math.random();
            if (rand < 0.05) {
              finalRawStatus = "Return";
            } else if (rand < 0.10) {
              finalRawStatus = "On Hold";
            } else if (rand < 0.15 && rawNextStatus === "Delivered") {
              finalRawStatus = "Partial Delivery";
            }

            // Normalize
            order.status = statusMap[finalRawStatus] || finalRawStatus;
            order.status_timestamp = new Date().toISOString();
          } catch (e) {
            console.error("Fetch failed", e);
          }
        }));
        saveDB(db);
      }
    };

    processQueue();
  });

  app.post("/api/clear-all", (req, res) => {
    try {
      const db = getDB();
      db.orders = [];
      saveDB(db);
      res.status(200).json({ message: "Database cleared successfully" });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to clear database: " + err.message });
    }
  });

  // Serve sample CSV
  app.get("/api/sample-csv", (req, res) => {
    const csvPath = path.join(process.cwd(), "sample.csv");
    if (fs.existsSync(csvPath)) {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=sample_fleettrack.csv");
      res.sendFile(csvPath);
    } else {
      res.status(404).send("Sample file not found");
    }
  });

  // Export CSV
  app.get("/api/export", async (req, res) => {
    const { stringify } = await import("csv-stringify/sync");
    const db = getDB();
    
    const data = db.orders.map(o => ({
      tracking_id: o.tracking_id,
      consignment_id: o.consignment_id,
      courier_name: o.courier_name,
      status: o.status,
      timestamp: o.status_timestamp
    }));

    const csv = stringify(data, { header: true });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=fleettrack_export.csv");
    res.send(csv);
  });

  // Settings
  app.get("/api/settings", (req, res) => {
    const db = getDB();
    res.json(db.settings);
  });

  app.post("/api/settings", (req, res) => {
    const db = getDB();
    db.settings = { ...db.settings, ...req.body };
    saveDB(db);
    res.json({ message: "Settings saved" });
  });

  // Logs
  app.get("/api/logs", (req, res) => {
    res.json(getLogs());
  });

  // --- Webhooks ---

  app.post("/webhooks/carrybee", (req, res) => {
    const db = getDB();
    const webhookSecret = db.settings.carrybee_webhook_secret || "f3992ecc-59da-4cbe-a049-a13da2018d51";
    const incomingHeader = req.headers["x-cb-webhook-integration-header"];
    const payload = req.body;

    // 1. Respond IMMEDIATELY with 202 and required header
    res.writeHead(202, {
      "X-CB-Webhook-Integration-Header": webhookSecret,
      "Content-Type": "text/plain"
    });
    res.end("Accepted");

    // 2. Background processing
    setImmediate(() => {
      try {
        if (incomingHeader !== webhookSecret) {
          saveLog({ courier: "CarryBee", error: "Unauthorized: Invalid Secret", receivedHeader: incomingHeader });
          return;
        }

        saveLog({ courier: "CarryBee", payload });

        const { consignment_id, status } = payload;
        if (consignment_id) {
           const currentDb = getDB();
           const order = currentDb.orders.find(o => o.consignment_id === consignment_id || o.tracking_id === consignment_id);
           if (order) {
             order.status = status || "Updated via Webhook";
             order.status_timestamp = new Date().toISOString();
             order.last_webhook_update = new Date().toISOString();
             saveDB(currentDb);
           }
        }
      } catch (err: any) {
        saveLog({ courier: "CarryBee", error: "Processing failure", details: err.message });
      }
    });
  });

  app.post("/webhooks/pathao", (req, res) => {
    const db = getDB();

    const webhookSecret =
      db?.settings?.pathao_webhook_secret ??
      process.env.PATHAO_WEBHOOK_SECRET ??
      "f3992ecc-59da-4cbe-a049-a13da2018d51";

    // ⚡ MUST: respond instantly (NO async BEFORE response)
    res.setHeader("X-Pathao-Merchant-Webhook-Integration-Secret", webhookSecret);
    res.status(202).end("Accepted");

    // background processing ONLY after response
    setImmediate(() => {
      try {
        const incomingHeader = req.get("X-Pathao-Merchant-Webhook-Integration-Secret");
        const incomingSignature = req.get("X-PATHAO-Signature");
        const payload = req.body;

        if (!payload) return;

        // Handle validation event specifically
        if (payload.event === "webhook_integration") {
          saveLog({ courier: "Pathao", message: "Webhook integration validated successfully", payload });
          return;
        }

        // Security check for real events
        if (incomingHeader !== webhookSecret && incomingSignature !== webhookSecret) {
          saveLog({ 
            courier: "Pathao", 
            error: "Unauthorized Webhook", 
            receivedHeader: incomingHeader || incomingSignature 
          });
          return;
        }

        if (!payload.consignment_id || !payload.event) return;

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
          "order.exchange": "Exchange"
        };

        const targetStatus = eventMap[payload.event];
        if (!targetStatus) return;

        const currentDb = getDB();

        const order = currentDb.orders.find((o: any) =>
          o.consignment_id === payload.consignment_id ||
          o.tracking_id === payload.merchant_order_id
        );

        if (!order) return;

        // Update if status changed
        if (order.status !== targetStatus) {
          order.status = targetStatus;
          order.status_timestamp = payload.timestamp || payload.updated_at || new Date().toISOString();
          order.last_webhook_update = new Date().toISOString();
          saveDB(currentDb);
        }

        saveLog({
          courier: "Pathao",
          message: `Updated ${payload.consignment_id} → ${targetStatus}`,
          payload
        });

      } catch (err: any) {
        saveLog({
          courier: "Pathao",
          error: "Processing Error",
          details: err.message
        });
      }
    });
  });

  // --- Vite ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
