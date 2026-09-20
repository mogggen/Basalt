/* global CodeMirror, mermaid, fixOrderedLists, htmlToMarkdown, findPreviewBlocks, findUnderlineSpans, widgetSignature */
(function () {
  "use strict";
  const $ = (sel) => document.querySelector(sel);
  const fileListEl = $("#filelist");
  const statusEl = $("#status");
  const saveEl = $("#savestate");
  const keymapEl = $("#keymap-label");
  const importInput = $("#import-file");

  let currentFile = null;
  let lastNewNote = 0;
  let mermaidInit = false;
  let vimInsert = false;
  let applying = false;
  let lastWidgetSig = "";

  const cm = CodeMirror.fromTextArea($("#editor"), {
    mode: { name: "markdown", strikethrough: true, highlightFormatting: true, taskLists: true },
    keyMap: "vim",
    lineNumbers: true,
    lineWrapping: true,
    autoCloseBrackets: true,
    styleActiveLine: true,
    fencedCodeBlockHighlighting: false,
    placeholder: "Start writing… (vim motions, tables, mermaid, paste images or HTML)",
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
    "Ctrl-S": () => saveNow({ force: true }), "Cmd-S": () => saveNow({ force: true }),
    "Ctrl-N": newUnnamed, "Cmd-N": newUnnamed,
  };
  cm.addKeyMap(formatMap);
  if (window.CodeMirror?.Vim) {
    const Vim = CodeMirror.Vim;
    Vim.defineAction("bold", bold);
    Vim.defineAction("italic", italic);
    Vim.defineAction("underline", underline);
    Vim.defineAction("strike", strike);
    Vim.defineAction("newUnnamed", newUnnamed);
    for (const [keys, name] of [["<C-b>", "bold"], ["<C-i>", "italic"], ["<C-u>", "underline"], ["<C-S-x>", "strike"], ["<C-n>", "newUnnamed"]]) {
      try { Vim.mapCommand(keys, "action", name, {}, { context: "insert" }); } catch {}
      try { Vim.mapCommand(keys, "action", name, {}, { context: "normal" }); } catch {}
    }
  }

  cm.on("vim-mode-change", (ev) => {
    vimInsert = ev.mode === "insert" || ev.mode === "replace";
    keymapEl.textContent = vimInsert ? "-- INSERT --" : "vim";
    if (!vimInsert) {
      scheduleSave();
      refreshWidgetsSoon();
      refreshUnderlines();
    }
  });

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (!(e.ctrlKey || e.metaKey)) return;
    if (key === "n") { e.preventDefault(); newUnnamed(); }
    if (key === "s") { e.preventDefault(); saveNow({ force: true }); }
    if (key === "b") { e.preventDefault(); bold(); }
    if (key === "i" && !e.shiftKey) { e.preventDefault(); italic(); }
    if (key === "u") { e.preventDefault(); underline(); }
    if (key === "x" && e.shiftKey) { e.preventDefault(); strike(); }
  }, true);

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
        if (currentFile === f.name) { currentFile = null; cm.setValue(""); lastWidgetSig = ""; refreshWidgetsSoon(); }
        loadFileList();
      });
      li.appendChild(del);
      fileListEl.appendChild(li);
    }
    if (selectName) openFile(selectName);
    else if (!currentFile && files.length) openFile(files[0].name);
  }

  async function openFile(name) {
    await saveNow({ force: true });
    currentFile = name;
    lastWidgetSig = "";
    cm.setValue(await (await fetch(`/api/file?name=${encodeURIComponent(name)}`)).text());
    [...fileListEl.children].forEach((li) => li.classList.toggle("active", li.dataset.name === name));
    refreshWidgetsSoon();
    refreshUnderlines();
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

  let saveTimer = null, widgetTimer = null;
  const scheduleSave = () => {
    if (vimInsert) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNow(), 800);
  };

  cm.on("change", () => {
    if (applying) return;
    saveEl.textContent = "…";
    updateCounts();
    refreshUnderlines();
    if (vimInsert) return;
    scheduleSave();
    refreshWidgetsSoon();
  });
  cm.on("cursorActivity", () => {
    if (vimInsert) return;
    refreshWidgetsSoon();
    refreshUnderlines();
  });

  function applyFixedText(text) {
    applying = true;
    try {
      const cur = cm.getCursor();
      const last = cm.lastLine();
      cm.replaceRange(text, { line: 0, ch: 0 }, { line: last, ch: cm.getLine(last).length });
      cm.setCursor(cur);
    } finally {
      applying = false;
    }
  }

  async function saveNow(opts) {
    const force = opts && opts.force;
    clearTimeout(saveTimer);
    if (!currentFile) return;
    if (vimInsert && !force) return;
    let content = cm.getValue();
    const fixed = fixOrderedLists(content);
    if (fixed !== content) {
      content = fixed;
      applyFixedText(fixed);
    }
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

  const widgetMarks = [];
  const widgetCache = new Map();
  const underlineMarks = [];

  function withPreservedScroll(fn) {
    const sc = cm.getScrollInfo();
    fn();
    cm.scrollTo(sc.left, sc.top);
  }

  function refreshWidgetsSoon() {
    clearTimeout(widgetTimer);
    widgetTimer = setTimeout(() => {
      refreshWidgets().catch((e) => console.warn("widgets", e));
    }, 120);
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
    const sig = widgetSignature(blocks, sel) + "\n" +
      blocks.map((b) => cm.getRange({ line: b.from, ch: 0 }, { line: b.to, ch: cm.getLine(b.to).length })).join("\x1e");
    if (sig === lastWidgetSig) return;
    lastWidgetSig = sig;

    withPreservedScroll(() => {
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
          widgetCache.set(key, node);
          fillWidget(node, block.type, source);
        }
        node.onmousedown = (e) => {
          e.preventDefault();
          lastWidgetSig = "";
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
    });
    if (widgetCache.size > 80) {
      for (const [key, node] of widgetCache) {
        if (!node.isConnected) widgetCache.delete(key);
      }
    }
  }

  function posLte(a, b) {
    return a.line < b.line || (a.line === b.line && a.ch <= b.ch);
  }
  function selectionTouchesSpan(sel, span) {
    const lo = posLte(sel.anchor, sel.head) ? sel.anchor : sel.head;
    const hi = posLte(sel.anchor, sel.head) ? sel.head : sel.anchor;
    return posLte(span.openFrom, hi) && posLte(lo, span.closeTo);
  }

  function refreshUnderlines() {
    withPreservedScroll(() => {
      for (const m of underlineMarks.splice(0)) {
        try { m.clear(); } catch {}
      }
      const text = cm.getValue();
      const sel = cm.listSelections();
      for (const span of findUnderlineSpans(text)) {
        underlineMarks.push(cm.markText(span.innerFrom, span.innerTo, {
          className: "cm-underline",
          inclusiveLeft: true,
          inclusiveRight: true,
        }));
        const editing = sel.some((s) => selectionTouchesSpan(s, span));
        if (!editing) {
          underlineMarks.push(cm.markText(span.openFrom, span.openTo, { collapsed: true, atomic: true }));
          underlineMarks.push(cm.markText(span.closeFrom, span.closeTo, { collapsed: true, atomic: true }));
        }
      }
    });
  }

  function resolvePreviewNode(root) {
    root.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") || "";
      if (!/^(https?:|data:|\/|#)/i.test(src)) img.setAttribute("src", "/notes/" + src);
      img.addEventListener("load", () => {
        const sc = cm.getScrollInfo();
        cm.refresh();
        cm.scrollTo(sc.left, sc.top);
      });
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
      const sc = cm.getScrollInfo();
      node.innerHTML = html;
      resolvePreviewNode(node);
      if (type === "mermaid") await renderMermaidIn(node);
      cm.refresh();
      cm.scrollTo(sc.left, sc.top);
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
    if (e.clipboardData?.files?.length) { e.preventDefault(); handleFiles(e.clipboardData.files); return; }
    const html = e.clipboardData?.getData("text/html") || "";
    if (htmlLooksRich(html)) {
      e.preventDefault();
      cm.replaceSelection(htmlToMarkdown(html));
      cm.focus();
    }
  });

  function htmlLooksRich(html) {
    return /<(?:b|strong|i|em|u|s|strike|del|table|thead|tbody|tr|img|h[1-6]|li|ul|ol|blockquote|pre|a)\b/i.test(html);
  }

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
      catch (err) { if (err.name === "AbortError") return; }
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
      await saveNow({ force: true });
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
    } catch (err) {
      statusP.textContent = err.message || String(err);
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
