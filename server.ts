console.log("SERVER.TS IS STARTING...");
import express from "express";
import { createServer as createViteServer } from "vite";
import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new sqlite3.Database(path.join(__dirname, "meter_readings.db"), (err) => {
  if (err) {
    console.error("Failed to connect to database:", err.message);
  } else {
    console.log("Connected to the SQLite database.");
    db.run(`
      CREATE TABLE IF NOT EXISTS readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT,
        customer_id TEXT,
        pea_meter_no TEXT,
        reading_month INTEGER,
        reading_year INTEGER,
        image_base64 TEXT,
        data JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error("Error creating table:", err.message);
        return;
      }
      // Ensure image_base64 column exists for existing databases
      db.all("PRAGMA table_info(readings)", (err, rows: any[]) => {
        if (err) {
          console.error("Error checking table info:", err.message);
          return;
        }
        const hasImageColumn = rows && rows.some(row => row.name === 'image_base64');
        if (!hasImageColumn) {
          console.log("Adding image_base64 column to readings table...");
          db.run("ALTER TABLE readings ADD COLUMN image_base64 TEXT", (err) => {
            if (err) console.error("Error adding column:", err.message);
            else console.log("Column added successfully.");
          });
        }
      });
    });
  }
});

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

async function startServer() {
  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", db: !!db });
  });

  // API Routes
  app.get("/api/readings", (req, res) => {
    console.log("GET /api/readings", req.query);
    const { name, month, year } = req.query;
    let query = "SELECT * FROM readings WHERE 1=1";
    const params: any[] = [];

    if (name) {
      query += " AND customer_name LIKE ?";
      params.push(`%${name}%`);
    }
    if (month) {
      query += " AND reading_month = ?";
      params.push(month);
    }
    if (year) {
      query += " AND reading_year = ?";
      params.push(year);
    }

    query += " ORDER BY created_at DESC";
    
    db.all(query, params, (err, rows) => {
      if (err) {
        console.error("GET /api/readings error:", err.message);
        return res.status(500).json({ error: err.message });
      }
      console.log(`Fetched ${rows.length} readings. First reading has image: ${!!(rows[0] as any)?.image_base64}`);
      res.json(rows.map((row: any) => ({
        ...row,
        data: JSON.parse(row.data)
      })));
    });
  });

  app.get("/api/readings/:id", (req, res) => {
    db.get("SELECT * FROM readings WHERE id = ?", [req.params.id], (err, row: any) => {
      if (err) {
        console.error("GET /api/readings/:id error:", err.message);
        return res.status(500).json({ error: err.message });
      }
      if (row) {
        res.json({
          ...row,
          data: JSON.parse(row.data)
        });
      } else {
        res.status(404).json({ error: "Not found" });
      }
    });
  });

  app.post("/api/readings", (req, res) => {
    const { customer_name, customer_id, pea_meter_no, reading_month, reading_year, data } = req.body;
    console.log(`POST /api/readings: ${customer_name} (No image saved per request)`);
    
    if (!customer_name || !customer_id || !pea_meter_no) {
      return res.status(400).json({ error: "กรุณากรอกข้อมูลพื้นฐานให้ครบถ้วน (ชื่อ, ID, หมายเลขมิเตอร์)" });
    }

    const query = `
      INSERT INTO readings (customer_name, customer_id, pea_meter_no, reading_month, reading_year, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    db.run(query, [customer_name, customer_id, pea_meter_no, reading_month, reading_year, JSON.stringify(data || {})], function(err) {
      if (err) {
        console.error("POST /api/readings error:", err.message);
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID });
    });
  });

  app.delete("/api/readings/:id", (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "ID ไม่ถูกต้อง" });
    }
    console.log(`Attempting to delete reading with ID: ${id}`);
    db.run("DELETE FROM readings WHERE id = ?", [id], function(err) {
      if (err) {
        console.error(`DELETE /api/readings/${id} error:`, err.message);
        return res.status(500).json({ error: err.message });
      }
      console.log(`Delete result for ID ${id}: ${this.changes} rows affected`);
      if (this.changes === 0) {
        return res.status(404).json({ error: "ไม่พบข้อมูลที่ต้องการลบในฐานข้อมูล" });
      }
      res.json({ success: true });
    });
  });

  app.put("/api/readings/:id", (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "ID ไม่ถูกต้อง" });
    }
    const { customer_name, customer_id, pea_meter_no, reading_month, reading_year, data } = req.body;
    console.log(`PUT /api/readings/${id}: ${customer_name} (No image saved per request)`);
    
    if (!customer_name || !customer_id || !pea_meter_no) {
      return res.status(400).json({ error: "กรุณากรอกข้อมูลพื้นฐานให้ครบถ้วน" });
    }

    const query = `
      UPDATE readings 
      SET customer_name = ?, customer_id = ?, pea_meter_no = ?, reading_month = ?, reading_year = ?, data = ?
      WHERE id = ?
    `;
    
    db.run(query, [customer_name, customer_id, pea_meter_no, reading_month, reading_year, JSON.stringify(data || {}), id], function(err) {
      if (err) {
        console.error("PUT /api/readings error:", err.message);
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: "ไม่พบข้อมูลที่ต้องการแก้ไข" });
      }
      res.json({ success: true });
    });
  });

  // API 404 handler
  app.use("/api", (req, res) => {
    console.warn(`API 404: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  // Vite middleware for development
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    try {
      console.log("Starting Vite in middleware mode...");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("Vite middleware attached.");
    } catch (viteError) {
      console.error("Failed to start Vite server:", viteError);
    }
  } else {
    console.log("Serving static files from dist...");
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Export app for Vercel
export default app;

startServer();
