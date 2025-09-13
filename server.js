import dotenv from "dotenv";
dotenv.config();

import bcrypt from "bcrypt";
import compression from "compression";
import MongoStoreFactory from "connect-mongo";
import express from "express";
import session from "express-session";
import mongoose from "mongoose";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");

const {
  MONGODB_URI = "",
  SESSION_SECRET = "",
  PORT = 3000,
} = process.env;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set. Please set it in your environment.");
  process.exit(1);
}
if (!SESSION_SECRET) {
  console.error("SESSION_SECRET is not set. Please set it in your environment.");
  process.exit(1);
}

mongoose.set("strictQuery", false);

async function connectDb(uri) {
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log("Connected to MongoDB");
}

const { Schema, model, Types } = mongoose;

const UserSchema = new Schema({
  username: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: () => new Date() },
});

const TaskSchema = new Schema({
  owner: { type: Types.ObjectId, ref: "User", required: true, index: true },
  title: { type: String, required: true, maxlength: 200 },
  priority: { type: String, enum: ["low", "medium", "high", "critical"], required: true },
  estimateHrs: { type: Number, required: true, min: 0.1, max: 100 },
  deadline: { type: Date, default: null },
  notes: { type: String, default: "" },
  important: { type: Boolean, default: false },
  status: { type: String, enum: ["active", "backlog", "done"], default: "active" },
  urgencyScore: { type: Number, default: 0 },
  createdAt: { type: Date, default: () => new Date() },
});

const User = model("User", UserSchema);
const Task = model("Task", TaskSchema);

function computeDerived(task) {
  const priorityWeight = { low: 1, medium: 2, high: 3, critical: 5 };

  if (task.deadline) {
    const deadlineDate = new Date(task.deadline);
    const now = new Date();
    const hoursUntilDeadline = Math.max(1, (deadlineDate - now) / (1000 * 60 * 60));
    task.urgencyScore = Number((priorityWeight[task.priority] / (hoursUntilDeadline / 24)).toFixed(2));
  } else {
    task.urgencyScore = priorityWeight[task.priority];
  }
  return task;
}

const app = express();

app.use(compression());
app.use(express.json({ limit: "100kb" }));

const MongoStore = MongoStoreFactory;

const sessionStore = MongoStore.create({
  mongoUrl: MONGODB_URI,
  collectionName: "sessions",
  ttl: 60 * 60 * 24,
});

app.use(session({
  name: "taskrush.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: 1000 * 60 * 60 * 24,
  },
}));

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${req.session?.userId ? "(auth)" : ""}`);
  next();
});

app.use(express.static(PUBLIC_DIR, {
  extensions: ["html", "htm"],
  maxAge: 1000 * 60 * 60 * 24,
  setHeaders: (res, path) => {
    if (path.endsWith('.html') || path.endsWith('.htm')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

async function createUser(username, password) {
  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(password, saltRounds);
  const user = new User({ username, passwordHash });
  await user.save();
  return user;
}

async function verifyPassword(user, password) {
  return bcrypt.compare(password, user.passwordHash);
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "username and password required" });

    const normalized = String(username).trim().toLowerCase();
    let user = await User.findOne({ username: normalized }).exec();

    if (!user) {
      user = await createUser(normalized, password);
      req.session.userId = user._id.toString();
      await new Promise((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      return res.status(201).json({ message: "Account created and logged in", created: true, username: user.username });
    }

    const ok = await verifyPassword(user, password);
    if (!ok) {
      return res.status(401).json({ error: "Invalid password" });
    }

    req.session.userId = user._id.toString();
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    return res.json({ message: "Logged in", created: false, username: user.username });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/auth/logout", (req, res) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        console.error("Session destroy error:", err);
        return res.status(500).json({ error: "Failed to logout" });
      }
      res.clearCookie("taskrush.sid", {
        httpOnly: true,
        secure: false,
        maxAge: 0
      });
      return res.json({ message: "Logged out" });
    });
  } else {
    res.json({ message: "No active session" });
  }
});

app.get("/auth/me", async (req, res) => {
  if (!req.session || !req.session.userId) return res.status(200).json({ authenticated: false });
  try {
    const user = await User.findById(req.session.userId).select("username createdAt").lean().exec();
    if (!user) return res.status(200).json({ authenticated: false });
    return res.json({ authenticated: true, user });
  } catch (err) {
    console.error("auth/me error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/tasks", requireAuth, async (req, res) => {
  try {
    const tasks = await Task.find({ owner: req.session.userId }).sort({ createdAt: -1 }).lean().exec();
    const out = tasks.map((t) => ({
      id: t._id.toString(),
      title: t.title,
      priority: t.priority,
      estimateHrs: t.estimateHrs,
      deadline: t.deadline ? t.deadline.toISOString().slice(0, 10) : null,
      notes: t.notes || "",
      important: !!t.important,
      status: t.status || "active",
      urgencyScore: t.urgencyScore,
      createdAt: t.createdAt,
    }));
    return res.json(out);
  } catch (err) {
    console.error("GET /api/tasks error:", err);
    return res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

app.post("/api/tasks", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || typeof body.title !== "string") return res.status(400).json({ error: "Title required" });
    if (!["low", "medium", "high", "critical"].includes(body.priority)) return res.status(400).json({ error: "Invalid priority" });
    if (typeof body.estimateHrs !== "number" || body.estimateHrs <= 0 || body.estimateHrs > 100) return res.status(400).json({ error: "Invalid estimate" });

    let deadline = null;
    if (body.deadline) {
      const d = new Date(body.deadline);
      if (isNaN(d.getTime())) return res.status(400).json({ error: "Invalid deadline date" });
      deadline = d;
    }

    let task = new Task({
      owner: req.session.userId,
      title: body.title.trim(),
      priority: body.priority,
      estimateHrs: body.estimateHrs,
      deadline,
      notes: body.notes || "",
      important: !!body.important,
      status: body.status || "active",
      createdAt: new Date(),
    });

    computeDerived(task);
    await task.save();

    const tasks = await Task.find({ owner: req.session.userId }).sort({ createdAt: -1 }).lean().exec();
    const out = tasks.map((t) => ({
      id: t._id.toString(),
      title: t.title,
      priority: t.priority,
      estimateHrs: t.estimateHrs,
      deadline: t.deadline ? t.deadline.toISOString().slice(0, 10) : null,
      notes: t.notes || "",
      important: !!t.important,
      status: t.status || "active",
      urgencyScore: t.urgencyScore,
      createdAt: t.createdAt,
    }));
    return res.json(out);
  } catch (err) {
    console.error("POST /api/tasks error:", err);
    return res.status(500).json({ error: "Failed to create task" });
  }
});

app.put("/api/tasks/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "Task id required" });

    const task = await Task.findById(id).exec();
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.owner.toString() !== req.session.userId) return res.status(403).json({ error: "Not authorized" });

    const body = req.body || {};
    if (body.title !== undefined) task.title = String(body.title).trim();
    if (body.priority !== undefined) {
      if (!["low", "medium", "high", "critical"].includes(body.priority)) return res.status(400).json({ error: "Invalid priority" });
      task.priority = body.priority;
    }
    if (body.estimateHrs !== undefined) {
      if (typeof body.estimateHrs !== "number" || body.estimateHrs <= 0 || body.estimateHrs > 100) return res.status(400).json({ error: "Invalid estimate" });
      task.estimateHrs = body.estimateHrs;
    }
    if (body.deadline !== undefined) {
      if (body.deadline === null || body.deadline === "") {
        task.deadline = null;
      } else {
        const d = new Date(body.deadline);
        if (isNaN(d.getTime())) return res.status(400).json({ error: "Invalid deadline date" });
        task.deadline = d;
      }
    }
    if (body.notes !== undefined) task.notes = String(body.notes || "");
    if (body.important !== undefined) task.important = Boolean(body.important);
    if (body.status !== undefined) {
      if (!["active", "backlog", "done"].includes(body.status)) return res.status(400).json({ error: "Invalid status" });
      task.status = body.status;
    }

    computeDerived(task);
    await task.save();

    const tasks = await Task.find({ owner: req.session.userId }).sort({ createdAt: -1 }).lean().exec();
    const out = tasks.map((t) => ({
      id: t._id.toString(),
      title: t.title,
      priority: t.priority,
      estimateHrs: t.estimateHrs,
      deadline: t.deadline ? t.deadline.toISOString().slice(0, 10) : null,
      notes: t.notes || "",
      important: !!t.important,
      status: t.status || "active",
      urgencyScore: t.urgencyScore,
      createdAt: t.createdAt,
    }));

    return res.json(out);
  } catch (err) {
    console.error("PUT /api/tasks/:id error:", err);
    return res.status(500).json({ error: "Failed to update task" });
  }
});

app.delete("/api/tasks/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const task = await Task.findById(id).exec();
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.owner.toString() !== req.session.userId) return res.status(403).json({ error: "Not authorized" });

    await Task.deleteOne({ _id: id }).exec();

    const tasks = await Task.find({ owner: req.session.userId }).sort({ createdAt: -1 }).lean().exec();
    const out = tasks.map((t) => ({
      id: t._id.toString(),
      title: t.title,
      priority: t.priority,
      estimateHrs: t.estimateHrs,
      deadline: t.deadline ? t.deadline.toISOString().slice(0, 10) : null,
      urgencyScore: t.urgencyScore,
      createdAt: t.createdAt,
    }));

    return res.json(out);
  } catch (err) {
    console.error("DELETE /api/tasks/:id error:", err);
    return res.status(500).json({ error: "Failed to delete task" });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

async function start() {
  try {
    await connectDb(MONGODB_URI);
    app.listen(PORT, () => {
      console.log(`Server (Express) listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();
