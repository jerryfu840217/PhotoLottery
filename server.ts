import express from "express";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import sharp from "sharp";

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Use DATA_DIR from environment or fallback to local ./data
const dbDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new Database(path.join(dbDir, "lottery.db"), { timeout: 10000 });
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -32000'); // 32MB cache

db.exec(`
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    originalName TEXT NOT NULL,
    participantName TEXT,
    uploadTime DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

try {
  db.prepare("ALTER TABLE photos ADD COLUMN participantName TEXT").run();
} catch (e) {
  // Column already exists, ignore
}

try {
  db.prepare("ALTER TABLE photos ADD COLUMN uploaderId TEXT").run();
} catch (e) {
  // Column already exists, ignore
}

try {
  db.prepare("ALTER TABLE photos ADD COLUMN is_drawn INTEGER DEFAULT 0").run();
} catch (e) {
  // Column already exists, ignore
}

db.exec(`
  CREATE TABLE IF NOT EXISTS target_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    originalName TEXT NOT NULL,
    uploadTime DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Setup Multer for file uploads
const uploadDir = path.join(dbDir, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPG and PNG are allowed."));
    }
  },
});

app.use(express.json());

import rateLimit from 'express-rate-limit';

// 套用全域限流 (防止惡意攻擊與短時間炸服)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 每 15 分鐘最多 300 個請求
  message: { error: "請求次數過多，請稍後再試。" },
  standardHeaders: true, 
  legacyHeaders: false,
});
app.use(limiter);

// 針對上傳介面可以套用更嚴格的限流
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 每分鐘最多上傳 30 張 (正常使用不太可能超過)
  message: { error: "上傳速度過快，請稍後再試。" },
});

// Serve uploaded files
app.use("/uploads", express.static(uploadDir, { maxAge: '1d', immutable: true }));

// API Routes
app.get("/api/target-photos", (req, res) => {
  try {
    const photos = db.prepare("SELECT * FROM target_photos ORDER BY uploadTime DESC").all();
    res.json(photos);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch target photos" });
  }
});

app.post("/api/target-photos", uploadLimiter, upload.single("photo"), (req, res) => {
  const isAdmin = req.headers['x-admin-password'] === '0000';
  if (!isAdmin) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded or invalid file type." });
  }
  try {
    const stmt = db.prepare("INSERT INTO target_photos (filename, originalName) VALUES (?, ?)");
    const info = stmt.run(req.file.filename, req.file.originalname);
    res.json({
      id: info.lastInsertRowid,
      filename: req.file.filename,
      originalName: req.file.originalname,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to save target photo record" });
  }
});

app.delete("/api/target-photos/:id", (req, res) => {
  const isAdmin = req.headers['x-admin-password'] === '0000';
  if (!isAdmin) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    const id = req.params.id;
    const photo: any = db.prepare("SELECT filename FROM target_photos WHERE id = ?").get(id);
    if (photo) {
      const filePath = path.join(uploadDir, photo.filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.error("Failed to delete target photo file:", e);
        }
      }
      db.prepare("DELETE FROM target_photos WHERE id = ?").run(id);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Target photo not found" });
    }
  } catch (err) {
    console.error("Delete target photo error:", err);
    res.status(500).json({ error: "Failed to delete target photo" });
  }
});

let photosCache: string | null = null;
let photosCacheTime = 0;

app.get("/api/photos", (req, res) => {
  try {
    const isAdmin = req.headers['x-admin-password'] === '0000';
    const uploaderId = req.headers['x-uploader-id'];

    if (isAdmin) {
      // 只有管理員才快取並回傳「所有人的」照片，以避免普通使用者端收到巨大 payload
      if (photosCache && Date.now() - photosCacheTime < 2000) {
        res.setHeader('Content-Type', 'application/json');
        return res.send(photosCache);
      }
      const photos = db.prepare("SELECT * FROM photos ORDER BY uploadTime DESC").all();
      photosCache = JSON.stringify(photos);
      photosCacheTime = Date.now();
      res.setHeader('Content-Type', 'application/json');
      return res.send(photosCache);
    } else {
      // 若為一般使用者（不論首輪載入或自行刷新），只回傳「自己」上傳的記錄
      if (!uploaderId) return res.json([]);
      const userPhotos = db.prepare("SELECT * FROM photos WHERE uploaderId = ? ORDER BY uploadTime DESC").all(uploaderId);
      return res.json(userPhotos);
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch photos" });
  }
});

app.post("/api/photos", uploadLimiter, upload.single("photo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded or invalid file type." });
  }

  try {
    const uploaderId = req.headers['x-uploader-id'] || '';
    
    // Check limit
    if (uploaderId) {
      const uploaderCountObj: any = db.prepare("SELECT COUNT(DISTINCT filename) as count FROM photos WHERE uploaderId = ?").get(uploaderId);
      if (uploaderCountObj && uploaderCountObj.count >= 3) {
         if (req.file) fs.unlinkSync(req.file.path);
         return res.status(429).json({ error: "每位賓客最多上傳三次唷，請將機會留給其他朋友~" });
      }
    }

    // Compress image
    const tempPath = req.file.path + '_temp';
    fs.renameSync(req.file.path, tempPath);
    await sharp(tempPath)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(req.file.path);
    fs.unlinkSync(tempPath);

    const namesString = req.body.participantName || '';
    const names = namesString.split(/[\n,]+/).map((n: string) => n.trim()).filter((n: string) => n);
    
    if (names.length === 0) {
      names.push('');
    }

    const stmt = db.prepare("INSERT INTO photos (filename, originalName, participantName, uploaderId) VALUES (?, ?, ?, ?)");
    
    const inserted: any[] = [];
    const insertMany = db.transaction((namesList) => {
      for (const name of namesList) {
        const info = stmt.run(req.file!.filename, req.file!.originalname, name, uploaderId);
        inserted.push({
          id: info.lastInsertRowid,
          filename: req.file!.filename,
          originalName: req.file!.originalname,
          participantName: name,
          uploaderId: uploaderId,
        });
      }
    });
    
    insertMany(names);
    
    // Invalidate cache
    photosCache = null;
    
    res.json(inserted);
  } catch (err: any) {
    console.error(err);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    // Delete temp file if exists from sharp error
    if (req.file && fs.existsSync(req.file.path + '_temp')) {
      fs.unlinkSync(req.file.path + '_temp');
    }
    res.status(500).json({ error: "Failed to save photo record" });
  }
});

app.post("/api/draw", (req, res) => {
  try {
    const winner = db.prepare("SELECT * FROM photos WHERE is_drawn = 0 OR is_drawn IS NULL ORDER BY RANDOM() LIMIT 1").get();
    if (!winner) {
      return res.status(404).json({ error: "目前已經沒有照片可以抽獎了！請確認是否已上傳照片或需重設抽獎紀錄。" });
    }
    db.prepare("UPDATE photos SET is_drawn = 1 WHERE id = ?").run(winner.id);
    // Invalidate cache
    photosCache = null;
    res.json(winner);
  } catch (err) {
    res.status(500).json({ error: "Failed to draw winner" });
  }
});

app.post("/api/draw/reset", (req, res) => {
  const isAdmin = req.headers['x-admin-password'] === '0000';
  if (!isAdmin) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  try {
    db.prepare("UPDATE photos SET is_drawn = 0").run();
    // Invalidate cache
    photosCache = null;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to reset draws" });
  }
});

app.delete("/api/photos", (req, res) => {
  const isAdmin = req.headers['x-admin-password'] === '0000';
  if (!isAdmin) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    const photos = db.prepare("SELECT filename FROM photos").all();
    
    // Clear database
    db.prepare("DELETE FROM photos").run();
    
    // Clear files
    for (const photo of photos as any[]) {
      try {
        const filePath = path.join(uploadDir, photo.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (e) {
        console.error(`Failed to delete file: ${photo.filename}`, e);
      }
    }
    
    // Invalidate cache
    photosCache = null;

    res.json({ success: true });
  } catch (err) {
    console.error("Failed to clear photos", err);
    res.status(500).json({ error: "Failed to clear photos" });
  }
});

app.delete("/api/photos/:id", (req, res) => {
  try {
    const id = req.params.id;
    const uploaderId = req.headers['x-uploader-id'];
    const isAdmin = req.headers['x-admin-password'] === '0000';
    
    const photo: any = db.prepare("SELECT filename, uploaderId FROM photos WHERE id = ?").get(id);
    
    if (photo) {
      if (!isAdmin && photo.uploaderId !== uploaderId) {
        return res.status(403).json({ error: "Unauthorized to delete this photo" });
      }

      const countObj: any = db.prepare("SELECT COUNT(*) as count FROM photos WHERE filename = ?").get(photo.filename);
      
      if (countObj && countObj.count <= 1) {
        const filePath = path.join(uploadDir, photo.filename);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (e) {
            console.error("Failed to delete photo file:", e);
          }
        }
      }
      db.prepare("DELETE FROM photos WHERE id = ?").run(id);
      
      // Invalidate cache
      photosCache = null;

      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Photo not found" });
    }
  } catch (err) {
    console.error("Delete photo error:", err);
    res.status(500).json({ error: "Failed to delete photo" });
  }
});

app.put("/api/photos/:id", (req, res) => {
  try {
    const id = req.params.id;
    const { participantName } = req.body;
    const uploaderId = req.headers['x-uploader-id'];
    const isAdmin = req.headers['x-admin-password'] === '0000';
    
    const photo: any = db.prepare("SELECT uploaderId FROM photos WHERE id = ?").get(id);
    if (!photo) {
      return res.status(404).json({ error: "Photo not found" });
    }

    if (!isAdmin && photo.uploaderId !== uploaderId) {
      return res.status(403).json({ error: "Unauthorized to edit this photo" });
    }
    
    const info = db.prepare("UPDATE photos SET participantName = ? WHERE id = ?").run(participantName, id);
    
    if (info.changes > 0) {
      // Invalidate cache
      photosCache = null;
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Photo not found" });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to update photo" });
  }
});

// Error handling middleware for multer
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File size exceeds 5MB limit." });
    }
    return res.status(400).json({ error: err.message });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    // Prioritize public folder for images and assets that might not have been copied properly
    app.use(express.static(path.join(process.cwd(), "public")));
    app.use('/prizes', express.static(path.join(process.cwd(), "public", "prizes")));
    
    app.use(express.static(path.join(process.cwd(), "dist")));

    // SPA Fallback
    const distPath = path.join(process.cwd(), 'dist');
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
