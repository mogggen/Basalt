#!/usr/bin/env node
/** Basalt — tiny FOSS markdown vault (Node + Express). MIT. */
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, spawn } = require("child_process");
const archiver = require("archiver");
const renderMarkdown = require("./render");
const fixOrderedLists = require("./public/js/fixlists");

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "127.0.0.1";
const NOTES_DIR = path.resolve(process.env.NOTES_DIR || path.join(__dirname, "notes"));
const ATTACHMENTS_DIR = path.join(NOTES_DIR, "attachments");

fs.mkdirSync(NOTES_DIR, { recursive: true });
fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

// Seed an empty vault with a demo note
if (!fs.readdirSync(NOTES_DIR).some((f) => /\.md$/i.test(f))) {
  fs.writeFileSync(
    path.join(NOTES_DIR, "welcome.md"),
    fs.readFileSync(path.join(__dirname, "templates", "welcome.md"), "utf8")
  );
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/notes", express.static(NOTES_DIR)); // serves attachments & local images

/** Only bare *.md files directly inside NOTES_DIR (no path traversal). */
function safeName(name) {
  if (typeof name !== "string") return null;
  const base = path.basename(name);
  return /^[\w][\w ().,\-\[\]]*\.md$/i.test(base) ? base : null;
}

app.get("/api/files", (_req, res) => {
  try {
    const files = fs.readdirSync(NOTES_DIR, { withFileTypes: true })
      .filter((d) => d.isFile() && /\.md$/i.test(d.name))
      .map((d) => {
        const st = fs.statSync(path.join(NOTES_DIR, d.name));
        return { name: d.name, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json(files);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/file", (req, res) => {
  const name = safeName(req.query.name);
  if (!name) return res.status(400).json({ error: "Invalid file name" });
  const file = path.join(NOTES_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "File not found" });
  res.type("text/plain; charset=utf-8").send(fs.readFileSync(file, "utf8"));
});

app.post("/api/file", (req, res) => {
  const name = safeName(req.body.name);
  if (!name) return res.status(400).json({ error: "Invalid file name (bare *.md, no slashes)" });
  const file = path.join(NOTES_DIR, name);
  if (fs.existsSync(file)) return res.status(409).json({ error: "File already exists" });
  fs.writeFileSync(file, String(req.body.content ?? ""));
  res.status(201).json({ ok: true, name });
});

app.put("/api/file", (req, res) => {
  const name = safeName(req.body.name);
  if (!name) return res.status(400).json({ error: "Invalid file name" });
  let content = typeof req.body.content === "string" ? req.body.content : "";
  if (req.body.fixLists) content = fixOrderedLists(content);
  fs.writeFileSync(path.join(NOTES_DIR, name), content);
  res.json({ ok: true, name, bytes: Buffer.byteLength(content, "utf8") });
});

app.delete("/api/file", (req, res) => {
  const name = safeName(req.query.name);
  if (!name) return res.status(400).json({ error: "Invalid file name" });
  const file = path.join(NOTES_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "File not found" });
  fs.unlinkSync(file);
  res.json({ ok: true });
});

app.post("/api/render", (req, res) => {
  res.json({ html: renderMarkdown(String(req.body.markdown || "")) });
});

// Paste/drop image upload → attachments/
app.post("/api/upload", express.raw({ type: "*/*", limit: "30mb" }), (req, res) => {
  const name = String(req.query.name || "");
  if (!/^[\w.-]+$/.test(name)) return res.status(400).json({ error: "Invalid file name" });
  fs.writeFileSync(path.join(ATTACHMENTS_DIR, name), req.body);
  res.json({ ok: true, path: `attachments/${name}` });
});

// Download whole vault as zip
app.get("/api/export", (_req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="basalt-vault-${stamp}.zip"`);
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", () => res.status(500).end());
  archive.pipe(res);
  archive.directory(NOTES_DIR, false);
  archive.finalize();
});

// Zip the vault and hand it to the magic-wormhole CLI; stream output (incl. the code) to the UI
let wormholeBusy = false;
app.get("/api/wormhole", (req, res) => {
  if (wormholeBusy) return res.status(409).type("text").send("A wormhole send is already in progress.");
  execFile("wormhole", ["--version"], { timeout: 8000 }, (err) => {
    if (err) {
      return res.status(500).type("text; charset=utf-8").send(
        "ERROR: the magic-wormhole CLI was not found on this machine.\n\nInstall it:\n" +
        "  pip/pipx install magic-wormhole | brew install magic-wormhole | apt install magic-wormhole\n\n" +
        "Meanwhile, the plain ZIP download (toolbar -> ZIP) always works."
      );
    }
    sendVault();
  });

  function sendVault() {
    const zipPath = path.join(os.tmpdir(), `basalt-vault-${Date.now()}.zip`);
    const archive = archiver("zip", { zlib: { level: 9 } });
    const out = fs.createWriteStream(zipPath);
    archive.on("error", (e) => finish(1, "zip error: " + e.message));
    archive.pipe(out);
    archive.directory(NOTES_DIR, false);
    archive.finalize();

    out.on("close", () => {
      wormholeBusy = true;
      const child = spawn("wormhole", ["send", zipPath], { stdio: ["ignore", "pipe", "pipe"] });
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      const fwd = (chunk) => { try { res.write(chunk.toString()); } catch { /* client gone */ } };
      child.stdout.on("data", fwd);
      child.stderr.on("data", fwd); // wormhole prints the code on stderr
      const onAbort = () => { try { child.kill("SIGTERM"); } catch {} };
      req.on("close", onAbort);
      child.on("close", (code) => {
        req.off("close", onAbort);
        wormholeBusy = false;
        fs.unlink(zipPath, () => {});
        finish(code);
      });
    });

    function finish(code, note) {
      try {
        if (note) res.write("\n" + note + "\n");
        res.end(`\n[wormhole exited with code ${code}]\n`);
      } catch {}
    }
  }
});

app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));

app.listen(PORT, HOST, () => {
  console.log(`\n  ⛰  Basalt running → http://localhost:${PORT}`);
  console.log(`     vault: ${NOTES_DIR}\n`);
});