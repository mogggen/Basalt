/* global CodeMirror, mermaid, fixOrderedLists */
(function () {
  "use strict";
  const $ = (sel) => document.querySelector(sel);
  const fileListEl = $("#filelist");
  const statusEl = $("#status");
  const saveEl = $("#savestate");
  const importInput = $("#import-file");

  let currentFile = null;
  let lastNewNote = 0;
  let mermaidInit = false;

  /* ---------------- editor ---------------- */
  const cm = CodeMirror.fromTextArea($("#editor"), {
    mode: "markdown",
    keyMap: "vim",
    lineNumbers: true,
    lineWrapping: true,
    autoCloseBrackets: true,
    styleActiveLine: true,
    fencedCodeBlockHighlighting: false,
    placeholder: "Start writing… (vim motions, tables, mermaid, paste images)",
    extraKeys: {
      "Enter": "newlineAndIndentContinueMarkdownList",
      "Tab": (c) => (c.somethingSelected() ? c.indentSelection("add") : c.replaceSelection("  ")),
      "Shift-Tab": (c) => c.indentSelection("subtract"),
    },
  });

  function wrapSel(open, close) {
    close = close ?? open;
    const sel = cm.getSelection();
    cm.replaceSelection(open + (sel || "text") + close);
    if (!sel) {
      const cur = cm.getCursor();
      cm.setSelection(
        { line: cur.line, ch: cur.ch - close.length - 4 },
        { line: cur.line, ch: cur.ch - close.length }
      );
    }
    cm.focus();
  }
  function bold() { wrapSel("**"); }
  function italic() { wrapSel("*"); }
  function underline() { wrapSel("<u>", "</u>"); }
  function strike() { wrapSel("~~"); }
  function insertTable() {
    cm.replaceSelection("\n| Column A | Column B |\n| -------- | -------- |\n| cell     | cell     |\n");
    cm.focus();
  }

  const formatMap = {
    "Ctrl-B": bold, "Cmd-B": bold,
    "Ctrl-I": italic, "Cmd-I": italic,
    "Ctrl-U": underline, "Cmd-U": underline,
    "Ctrl-Shift-X": strike, "Shift-Ctrl-X": strike,
    "Cmd-Shift-X": strike, "Shift-Cmd-X": strike,
    "Ctrl-S": saveNow, "Cmd-S": saveNow,
    "Ctrl-N": newUnnamed, "Cmd-N": newUnnamed,
  };
  cm.addKeyMap(formatMap);
  if (window.CodeMirror?.Vim) {
    const Vim = CodeMirror.Vim;
    const maps = [
      ["<C-b>", "bold"], ["<C-i>", "italic"], ["<C-u>", "underline"],
      ["<C-S-x>", "strike"], ["<C-n>", "newUnnamed"],
    ];
    Vim.defineAction("bold", bold);
    Vim.defineAction("italic", italic);
    Vim.defineAction("underline", underline);
    Vim.defineAction("strike", strike);
    Vim.defineAction("newUnnamed", newUnnamed);
    for (const [keys, name] of maps) {
      try { Vim.mapCommand(keys, "action", name, {}, { context: "insert" }); } catch {}
      try { Vim.mapCommand(keys, "action", name, {}, { context: "normal" }); } catch {}
    }
  }

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (!(e.ctrlKey || e.metaKey)) return;
    if (key === "n") { e.preventDefault(); newUnnamed(); }
    if (key === "s") { e.preventDefault(); saveNow(); }
    if (key === "b") { e.preventDefault(); bold(); }
    if (key === "i" && !e.shiftKey) { e.preventDefault(); italic(); }
    if (key === "u") { e.preventDefault(); underline(); }
    if (key === "x" && e.shiftKey) { e.preventDefault(); strike(); }
  }, true);

  /* ---------------- files ---------------- */
  async function loadFileList(selectName) {
    const files = await (await fetch("/api/files")).json();
    fileListEl.innerHTML = "";
    for (const f of files) {
      const li = document.createElement("li");
      li.textContent = f.name;
      li.dataset.name = f.name;
      if (f.name === currentFile) li.classList.add("active");
      li.addEventListener("click", () => openFile(f.name));
      const del = document.createElement("button");
      del.className = "mini"; del.textContent = "×"; del.title = "Delete " + f.name;
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete “${f.name}”? This cannot be undone.`)) return;
        await fetch(`/api/file?name=${encodeURIComponent(f.name)}`, { method: "DELETE" });
        if (currentFile === f.name) { currentFile = null; cm.setValue(""); refreshWidgetsSoon(); }
        loadFileList();
      });
      li.appendChild(del);
      fileListEl.appendChild(li);
    }
    if (selectName) openFile(selectName);
    else if (!currentFile && files.length) openFile(files[0].name);
  }

  async function openFile(name) {
    await saveNow();
    currentFile = name;
    cm.setValue(await (await fetch(`/api/file?name=${encodeURIComponent(name)}`)).text());
    [...fileListEl.children].forEach((li) => li.classList.toggle("active", li.dataset.name === name));
    refreshWidgetsSoon();
    updateCounts();
    setStatus("Opened " + name);
  }

  async function newUnnamed() {
    const now = Date.now();
    if (now - lastNewNote < 400) return;
    lastNewNote = now;
    const res = await fetch("/api/file", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unnamed: true, name: "Unnamed.md", content: "# Unnamed\n\n" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data.error || "Could not create note");
    loadFileList(data.name);
  }

  $("#btn-new").addEventListener("click", newUnnamed);

  /* ---------------- save / autosave / numbering ---------------- */
  let saveTimer = null, widgetTimer = null;
  const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 800); };

  cm.on("change", () => { saveEl.textContent = "…"; scheduleSave(); refreshWidgetsSoon(); updateCounts(); });
  cm.on("cursorActivity", () => refreshWidgetsSoon());

  function setDoc(text) {
    const cur = cm.getCursor(), sc = cm.getScrollInfo();
    cm.setValue(text);
    cm.setCursor(cur); cm.scrollTo(sc.left, sc.top);
  }

  async function saveNow() {
    clearTimeout(saveTimer);
    if (!currentFile) return;
    let content = cm.getValue();
    const fixed = fixOrderedLists(content);
    if (fixed !== content) { content = fixed; setDoc(fixed); }
    const res = await fetch("/api/file", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: currentFile, content, fixLists: true }),
    });
    saveEl.textContent = res.ok ? "autosaved " + new Date().toLocaleTimeString() : "save FAILED";
  }

  $("#btn-bold").addEventListener("click", bold);
  $("#btn-italic").addEventListener("click", italic);
  $("#btn-underline").addEventListener("click", underline);
  $("#btn-strike").addEventListener("click", strike);
  $("#btn-table").addEventListener("click", insertTable);
  $("#btn-export").addEventListener("click", exportVault);
  $("#btn-import").addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", () => {
    if (importInput.files?.length) handleImport(importInput.files);
    importInput.value = "";
  });

  function exportVault() {
    const a = document.createElement("a");
    a.href = "/api/export"; a.download = ""; a.click();
  }

  async function handleImport(fileList) {
    for (const file of fileList) {
      const res = await fetch(`/api/import?name=${encodeURIComponent(file.name)}`, {
        method: "POST", body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setStatus("Import failed: " + (data.error || file.name)); continue; }
      setStatus("Imported " + (data.imported || []).join(", "));
      if (data.imported?.length) loadFileList(data.imported[0]);
      else loadFileList();
    }
  }

  /* ---------------- inline preview widgets ---------------- */
  const widgetMarks = [];
  const widgetCache = new Map();

  function refreshWidgetsSoon() {
    clearTimeout(widgetTimer);
    widgetTimer = setTimeout(() => {
      refreshWidgets().catch((e) => console.warn("widgets", e));
    }, 120);
  }

  function findPreviewBlocks(text) {
    const lines = text.split("\n");
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const fence = lines[i].match(/^(\s*)(`{3,}|~{3,})(.*)$/);
      if (fence) {
        const closer = fence[2].charAt(0);
        const len = fence[2].length;
        let j = i + 1;
        while (j < lines.length) {
          const m = lines[j].match(/^(\s*)(`{3,}|~{3,})/);
          if (m && m[2].charAt(0) === closer && m[2].length >= len) break;
          j++;
        }
        const lang = (fence[3] || "").trim().split(/\s+/)[0].toLowerCase();
        blocks.push({
          type: lang === "mermaid" ? "mermaid" : "code",
          from: i,
          to: Math.min(j, lines.length - 1),
        });
        i = j + 1;
        continue;
      }
      if (/^\s*\|/.test(lines[i])) {
        let j = i;
        while (j < lines.length && /^\s*\|/.test(lines[j])) j++;
        if (j - i >= 2) blocks.push({ type: "table", from: i, to: j - 1 });
        i = j;
        continue;
      }
      if (/^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(lines[i])) {
        blocks.push({ type: "image", from: i, to: i });
        i++;
        continue;
      }
      i++;
    }
    return blocks;
  }

  function cursorTouches(block, cur) {
    const a = cur.anchor || cur.head;
    const b = cur.head || cur.anchor;
    const lo = Math.min(a.line, b.line);
    const hi = Math.max(a.line, b.line);
    return !(hi < block.from || lo > block.to);
  }

  async function refreshWidgets() {
    const text = cm.getValue();
    const blocks = findPreviewBlocks(text);
    const sel = cm.listSelections();
    for (const m of widgetMarks.splice(0)) {
      try { m.clear(); } catch {}
    }
    for (const block of blocks) {
      if (sel.some((s) => cursorTouches(block, s))) continue;
      const source = cm.getRange({ line: block.from, ch: 0 }, { line: block.to, ch: cm.getLine(block.to).length });
      const key = block.type + "\n" + source;
      let node = widgetCache.get(key);
      if (!node) {
        node = document.createElement("div");
        node.className = "cm-preview-widget";
        node.dataset.key = key;
        widgetCache.set(key, node);
        fillWidget(node, block.type, source);
      }
      node.onmousedown = (e) => {
        e.preventDefault();
        cm.focus();
        cm.setCursor({ line: block.from, ch: 0 });
      };
      const mark = cm.markText(
        { line: block.from, ch: 0 },
        { line: block.to, ch: cm.getLine(block.to).length },
        { replacedWith: node, atomic: true, inclusiveLeft: false, inclusiveRight: false, handleMouseEvents: true }
      );
      widgetMarks.push(mark);
    }
    if (widgetCache.size > 80) {
      for (const [key, node] of widgetCache) {
        if (!node.isConnected) widgetCache.delete(key);
      }
    }
  }

  function resolvePreviewNode(root) {
    root.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") || "";
      if (!/^(https?:|data:|\/|#)/i.test(src)) img.setAttribute("src", "/notes/" + src);
    });
    root.querySelectorAll('a[href^="http"]').forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
  }

  async function fillWidget(node, type, source) {
    try {
      const res = await fetch("/api/render", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: source }),
      });
      const { html } = await res.json();
      node.innerHTML = html;
      resolvePreviewNode(node);
      if (type === "mermaid") await renderMermaidIn(node);
    } catch {
      node.innerHTML = '<p class="render-error">preview failed</p>';
    }
  }

  async function renderMermaidIn(root) {
    if (!window.mermaid) return;
    if (!mermaidInit) {
      mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: "dark" });
      mermaidInit = true;
    }
    const blocks = root.querySelectorAll("pre.mermaid-source > code.language-mermaid");
    for (const code of blocks) {
      const div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent;
      code.parentElement.replaceWith(div);
    }
    const nodes = [...root.querySelectorAll("div.mermaid:not([data-processed])")];
    if (nodes.length) {
      try { await mermaid.run({ nodes }); }
      catch (e) { console.warn("mermaid:", e); }
    }
  }

  function updateCounts() {
    const text = cm.getValue();
    const words = (text.match(/\S+/g) || []).length;
    statusEl.textContent = `${currentFile || "no file"} · ${words} words · ${text.length} chars`;
  }

  /* ---------------- image paste / drop ---------------- */
  const editorPane = $("#editor-pane");
  ["dragover", "drop"].forEach((ev) => editorPane.addEventListener(ev, (e) => e.preventDefault()));
  editorPane.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer.files || [])];
    const mdOrZip = files.filter((f) => /\.(md|zip)$/i.test(f.name));
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (mdOrZip.length) handleImport(mdOrZip);
    if (images.length) handleFiles(images);
  });
  cm.getWrapperElement().addEventListener("paste", (e) => {
    if (e.clipboardData?.files?.length) { e.preventDefault(); handleFiles(e.clipboardData.files); }
  });

  async function handleFiles(files) {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const ext = (file.name.match(/\.[a-z0-9]+$/i) || [".png"])[0];
      const base = (currentFile || "note").replace(/\.md$/i, "").replace(/[^\w.-]+/g, "-");
      const name = `${base}-${Date.now()}${ext}`;
      setStatus("Uploading " + file.name + "…");
      const res = await fetch(`/api/upload?name=${encodeURIComponent(name)}`, { method: "POST", body: file });
      if (!res.ok) { setStatus("Upload failed ✗"); continue; }
      const data = await res.json();
      cm.replaceSelection(`![](${data.path})\n`);
      cm.focus();
      setStatus("Image embedded: " + data.path);
    }
  }

  /* ---------------- wormhole.app share ---------------- */
  const modal = $("#wormhole-modal");
  const statusP = $("#wormhole-status");
  const qrImg = $("#wormhole-qr");
  const linkEl = $("#wormhole-link");
  const shareBtn = $("#wormhole-share");
  const copyBtn = $("#wormhole-copy");
  let shareUrl = "";

  $("#btn-wormhole").addEventListener("click", startWormhole);
  $("#wormhole-cancel").addEventListener("click", () => modal.classList.add("hidden"));
  copyBtn.addEventListener("click", async () => {
    if (shareUrl) await navigator.clipboard.writeText(shareUrl);
    setStatus("Share link copied");
  });
  shareBtn.addEventListener("click", async () => {
    if (!shareUrl) return;
    if (navigator.share) {
      try { await navigator.share({ title: "Basalt vault", url: shareUrl, text: shareUrl }); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    await navigator.clipboard.writeText(shareUrl);
    setStatus("Share link copied");
  });

  async function startWormhole() {
    modal.classList.remove("hidden");
    shareUrl = "";
    statusP.textContent = "Uploading an encrypted copy to wormhole.app…";
    qrImg.classList.add("hidden");
    linkEl.classList.add("hidden");
    shareBtn.classList.add("hidden");
    copyBtn.classList.add("hidden");
    try {
      await saveNow();
      const res = await fetch("/api/wormhole", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Share failed");
      shareUrl = data.url;
      qrImg.src = data.qrDataUrl;
      qrImg.classList.remove("hidden");
      linkEl.href = data.url;
      linkEl.textContent = data.url;
      linkEl.classList.remove("hidden");
      shareBtn.classList.remove("hidden");
      copyBtn.classList.remove("hidden");
      statusP.textContent = "Scan the QR code or share this wormhole.app link (expires in about 24h).";
    } catch (e) {
      statusP.textContent = e.message || String(e);
    }
  }

  if (window.basaltDesktop) {
    window.basaltDesktop.onNewNote(newUnnamed);
    window.basaltDesktop.onImport(() => importInput.click());
    window.basaltDesktop.onExport(exportVault);
    window.basaltDesktop.onShare(startWormhole);
  }

  function setStatus(msg) { statusEl.textContent = msg; }
  loadFileList();
})();
