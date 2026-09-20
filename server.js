#!/usr/bin/env node
/** Basalt — tiny FOSS markdown vault (Node + Express). MIT. */
const express = require("express");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const AdmZip = require("adm-zip");
const QRCode = require("qrcode");
const renderMarkdown = require("./render");
const fixOrderedLists = require("./public/js/fixlists");
const { uploadToWormholeApp } = require("./wormhole-app");

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "127.0.0.1";

function defaultNotesDir() {
  if (process.env.NOTES_DIR) return path.resolve(process.env.NOTES_DIR);
  if (process.versions.electron) {
    const { app } = require("electron");
    if (app && app.getPath) return path.join(app.getPath("userData"), "notes");
  }
  return path.join(__dirname, "notes");
}

function ensureVault(notesDir) {
  const attachments = path.join(notesDir, "attachments");
  fs.mkdirSync(notesDir, { recursive: true });
  fs.mkdirSync(attachments, { recursive: true });
  if (!fs.readdirSync(notesDir).some((f) => /\.md$/i.test(f))) {
    fs.writeFileSync(
      path.join(notesDir, "welcome.md"),
      fs.readFileSync(path.join(__dirname, "templates", "welcome.md"), "utf8")
    );
  }
}

function safeName(name) {
  if (typeof name !== "string") return null;
  const base = path.basename(name);
  return /^[\w][\w ().,\-\[\]]*\.md$/i.test(base) ? base : null;
}

function uniqueMdName(notesDir, wanted) {
  const parsed = safeName(wanted) || "Unnamed.md";
  const ext = ".md";
  const stem = parsed.replace(/\.md$/i, "");
  let name = parsed;
  let n = 2;
  while (fs.existsSync(path.join(notesDir, name))) {
    name = `${stem}-${n}${ext}`;
    n++;
  }
  return name;
}

function zipNotesToBuffer(notesDir) {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks = [];
    archive.on("data", (c) => chunks.push(c));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
    archive.directory(notesDir, false);
    archive.finalize();
  });
}

function createApp(notesDir) {
  notesDir = path.resolve(notesDir || defaultNotesDir());
  ensureVault(notesDir);
  const attachmentsDir = path.join(notesDir, "attachments");

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "20mb" }));
  app.use(express.static(path.join(__dirname, "public")));
  app.use("/notes", express.static(notesDir));

  app.get("/api/files", (_req, res) => {
    try {
      const files = fs.readdirSync(notesDir, { withFileTypes: true })
        .filter((d) => d.isFile() && /\.md$/i.test(d.name))
        .map((d) => {
          const st = fs.statSync(path.join(notesDir, d.name));
          return { name: d.name, size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      res.json(files);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/file", (req, res) => {
    const name = safeName(req.query.name);
    if (!name) return res.status(400).json({ error: "Invalid file name" });
    const file = path.join(notesDir, name);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "File not found" });
    res.type("text/plain; charset=utf-8").send(fs.readFileSync(file, "utf8"));
  });

  app.post("/api/file", (req, res) => {
    let name = safeName(req.body.name);
    if (!name && req.body.unnamed) name = uniqueMdName(notesDir, "Unnamed.md");
    if (!name) return res.status(400).json({ error: "Invalid file name (bare *.md, no slashes)" });
    if (req.body.unnamed) name = uniqueMdName(notesDir, name);
    const file = path.join(notesDir, name);
    if (fs.existsSync(file)) return res.status(409).json({ error: "File already exists", name });
    fs.writeFileSync(file, String(req.body.content ?? `# ${name.replace(/\.md$/i, "")}\n\n`));
    res.status(201).json({ ok: true, name });
  });

  app.put("/api/file", (req, res) => {
    const name = safeName(req.body.name);
    if (!name) return res.status(400).json({ error: "Invalid file name" });
    let content = typeof req.body.content === "string" ? req.body.content : "";
    if (req.body.fixLists !== false) content = fixOrderedLists(content);
    fs.writeFileSync(path.join(notesDir, name), content);
    res.json({ ok: true, name, bytes: Buffer.byteLength(content, "utf8"), content });
  });

  app.delete("/api/file", (req, res) => {
    const name = safeName(req.query.name);
    if (!name) return res.status(400).json({ error: "Invalid file name" });
    const file = path.join(notesDir, name);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "File not found" });
    fs.unlinkSync(file);
    res.json({ ok: true });
  });

  app.post("/api/render", (req, res) => {
    res.json({ html: renderMarkdown(String(req.body.markdown || "")) });
  });

  app.post("/api/upload", express.raw({ type: "*/*", limit: "30mb" }), (req, res) => {
    const name = String(req.query.name || "");
    if (!/^[\w.-]+$/.test(name)) return res.status(400).json({ error: "Invalid file name" });
    fs.writeFileSync(path.join(attachmentsDir, name), req.body);
    res.json({ ok: true, path: `attachments/${name}` });
  });

  app.post("/api/import", express.raw({ type: "*/*", limit: "50mb" }), (req, res) => {
    try {
      const given = String(req.query.name || "import.zip");
      const imported = [];
      if (/\.md$/i.test(given)) {
        const name = uniqueMdName(notesDir, path.basename(given));
        fs.writeFileSync(path.join(notesDir, name), req.body);
        imported.push(name);
      } else {
        const zip = new AdmZip(req.body);
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory) continue;
          const rel = entry.entryName.replace(/\\/g, "/");
          if (rel.includes("..")) continue;
          const base = path.basename(rel);
          if (/\.md$/i.test(base)) {
            const name = uniqueMdName(notesDir, base);
            fs.writeFileSync(path.join(notesDir, name), entry.getData());
            imported.push(name);
          } else if (/(^|\/)attachments\//.test(rel) && /^[\w.-]+$/.test(base)) {
            fs.writeFileSync(path.join(attachmentsDir, base), entry.getData());
          }
        }
      }
      res.json({ ok: true, imported });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/export", (_req, res) => {
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="basalt-vault-${stamp}.zip"`);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", () => res.status(500).end());
    archive.pipe(res);
    archive.directory(notesDir, false);
    archive.finalize();
  });

  let wormholeBusy = false;
  app.post("/api/wormhole", async (_req, res) => {
    if (wormholeBusy) return res.status(409).json({ error: "A wormhole send is already in progress." });
    wormholeBusy = true;
    try {
      const zip = await zipNotesToBuffer(notesDir);
      const stamp = new Date().toISOString().slice(0, 10);
      const result = await uploadToWormholeApp(zip, `basalt-vault-${stamp}.zip`);
      const qrDataUrl = await QRCode.toDataURL(result.url, {
        margin: 1,
        width: 280,
        color: { dark: "#1b1b1f", light: "#ffffff" },
      });
      res.json({ ok: true, ...result, qrDataUrl });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      wormholeBusy = false;
    }
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));
  return app;
}

function startServer({ port = PORT, host = HOST, notesDir } = {}) {
  notesDir = path.resolve(notesDir || defaultNotesDir());
  const app = createApp(notesDir);
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const addr = server.address();
      const url = `http://${host}:${addr.port}`;
      console.log(`\n  ⛰  Basalt running → ${url}`);
      console.log(`     vault: ${notesDir}\n`);
      resolve({ server, app, url, port: addr.port, notesDir });
    });
    server.on("error", reject);
  });
}

module.exports = { createApp, startServer, defaultNotesDir };

if (require.main === module) {
  startServer().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
