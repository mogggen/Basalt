/* global CodeMirror, mermaid, fixOrderedLists */
(function () {
  "use strict";
  const $ = (sel) => document.querySelector(sel);
  const preview = $("#preview");
  const previewPane = $("#preview-pane");
  const fileListEl = $("#filelist");
  const statusEl = $("#status");
  const saveEl = $("#savestate");
  const autofixChk = $("#chk-autofix");

  let currentFile = null;

  autofixChk.checked = localStorage.getItem("basalt-autofix") !== "0";
  autofixChk.addEventListener("change", () =>
    localStorage.setItem("basalt-autofix", autofixChk.checked ? "1" : "0"));

  /* ---------------- editor ---------------- */
  const cm = CodeMirror.fromTextArea($("#editor"), {
    mode: "markdown",
    lineNumbers: true,
    lineWrapping: true,
    autoCloseBrackets: true,
    styleActiveLine: true,
    fencedCodeBlockHighlighting: false,
    placeholder: "Start writing… (markdown, tables, ```mermaid blocks, paste images)",
    extraKeys: {
      "Enter": "newlineAndIndentContinueMarkdownList",
      "Ctrl-B": () => wrapSel("**"), "Cmd-B": () => wrapSel("**"),
      "Ctrl-I": () => wrapSel("*"),  "Cmd-I": () => wrapSel("*"),
      "Ctrl-K": insertLink, "Cmd-K": insertLink,
      "Ctrl-S": saveNow, "Cmd-S": saveNow,
      "Ctrl-Shift-L": fixLists, "Cmd-Shift-L": fixLists,
      "Tab": (c) => (c.somethingSelected() ? c.indentSelection("add") : c.replaceSelection("  ")),
      "Shift-Tab": (c) => c.indentSelection("subtract"),
    },
  });

  function wrapSel(marker) {
    const sel = cm.getSelection();
    cm.replaceSelection(marker + (sel || "text") + marker);
    if (!sel) {
      const cur = cm.getCursor();
      cm.setSelection({ line: cur.line, ch: cur.ch - marker.length - 4 },
                       { line: cur.line, ch: cur.ch - marker.length });
    }
    cm.focus();
  }
  function insertLink() {
    const sel = cm.getSelection() || "link text";
    cm.replaceSelection(`[${sel}](https://)`);
    const cur = cm.getCursor();
    cm.setSelection({ line: cur.line, ch: cur.ch - 9 }, { line: cur.line, ch: cur.ch - 1 });
    cm.focus();
  }
  function insertTable() {
    cm.replaceSelection("\n| Column A | Column B |\n| -------- | -------- |\n| cell     | cell     |\n");
    cm.focus();
  }
  function wrapCode() {
    const sel = cm.getSelection() || "code";
    cm.replaceSelection("```\n" + sel + "\n```\n");
    cm.focus();
  }

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
        if (currentFile === f.name) { currentFile = null; cm.setValue(""); renderSoon(); }
        loadFileList();
      });
      li.appendChild(del);
      fileListEl.appendChild(li);
    }
    if (selectName) openFile(selectName);
    else if (!currentFile && files.length) openFile(files[0].name);
  }

  async function openFile(name) {
    await saveNow(); // flush previous file
    currentFile = name;
    cm.setValue(await (await fetch(`/api/file?name=${encodeURIComponent(name)}`)).text());
    [...fileListEl.children].forEach((li) => li.classList.toggle("active", li.dataset.name === name));
    renderSoon();
    setStatus("Opened " + name);
  }

  $("#btn-new").addEventListener("click", async () => {
    const raw = (prompt("New note name:", "untitled.md") || "").trim();
    if (!raw) return;
    const name = /\.md$/i.test(raw) ? raw : raw + ".md";
    const res = await fetch("/api/file", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, content: "# " + name.replace(/\.md$/i, "") + "\n\n" }),
    });
    if (!res.ok) return alert((await res.json()).error);
    currentFile = name;
    loadFileList(name);
  });

  /* ---------------- save / fix ---------------- */
  let saveTimer = null, renderTimer = null;
  const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 800); };
  const renderSoon   = () => { clearTimeout(renderTimer); renderTimer = setTimeout(renderPreview, 200); };

  cm.on("change", () => { saveEl.textContent = "…"; scheduleSave(); renderSoon(); });

  function setDoc(text) {
    const cur = cm.getCursor(), sc = cm.getScrollInfo();
    cm.setValue(text);
    cm.setCursor(cur); cm.scrollTo(sc.left, sc.top);
  }

  async function saveNow() {
    clearTimeout(saveTimer);
    if (!currentFile) return;
    let content = cm.getValue();
    if (autofixChk.checked) {
      const fixed = fixOrderedLists(content);
      if (fixed !== content) { content = fixed; setDoc(fixed); }
    }
    const res = await fetch("/api/file", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: currentFile, content }),
    });
    saveEl.textContent = res.ok ? "saved " + new Date().toLocaleTimeString() : "save FAILED";
  }

  function fixLists() {
    const fixed = fixOrderedLists(cm.getValue());
    if (fixed !== cm.getValue()) {
      setDoc(fixed);
      setStatus("List numbering fixed ✓");
      saveNow(); renderSoon();
    } else setStatus("List numbering already sequential ✓");
  }

  $("#btn-save").addEventListener("click", saveNow);
  $("#btn-fix").addEventListener("click", fixLists);
  $("#btn-bold").addEventListener("click", () => wrapSel("**"));
  $("#btn-italic").addEventListener("click", () => wrapSel("*"));
  $("#btn-code").addEventListener("click", wrapCode);
  $("#btn-table").addEventListener("click", insertTable);
  $("#btn-export").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = "/api/export"; a.download = ""; a.click();
  });
  $("#btn-preview").addEventListener("click", () => {
    const off = document.body.classList.toggle("no-preview");
    $("#btn-preview").classList.toggle("on", !off);
  });

  /* ---------------- live preview ---------------- */
  async function renderPreview() {
    try {
      const res = await fetch("/api/render", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: cm.getValue() }),
      });
      const { html } = await res.json();
      preview.innerHTML = html;

      // resolve relative images (attachments) against /notes, open external links in new tab
      preview.querySelectorAll("img").forEach((img) => {
        const src = img.getAttribute("src") || "";
        if (!/^(https?:|data:|\/|#)/i.test(src)) img.setAttribute("src", "/notes/" + src);
      });
      preview.querySelectorAll('a[href^="http"]').forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });

      renderMermaid();
      updateCounts();
    } catch {
      preview.innerHTML = '<p class="render-error">render failed</p>';
    }
  }

  let mermaidInit = false;
  async function renderMermaid() {
    if (!window.mermaid) return;
    if (!mermaidInit) {
      mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: "dark" });
      mermaidInit = true;
    }
    const blocks = preview.querySelectorAll("pre.mermaid-source > code.language-mermaid");
    blocks.forEach((code) => {
      const div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent;
      code.parentElement.replaceWith(div);
    });
    if (blocks.length) {
      try { await mermaid.run({ nodes: [...preview.querySelectorAll("div.mermaid:not([data-processed])")] }); }
      catch (e) { console.warn("mermaid:", e); }
    }
  }

  function updateCounts() {
    const text = cm.getValue();
    const words = (text.match(/\S+/g) || []).length;
    statusEl.textContent = `${currentFile || "no file"} · ${words} words · ${text.length} chars`;
  }

  /* ---------------- scroll sync ---------------- */
  let scrollLock = null;
  cm.on("scroll", () => {
    if (scrollLock === "preview") return;
    scrollLock = "editor";
    const si = cm.getScrollInfo();
    const max = Math.max(1, si.height - si.clientHeight);
    previewPane.scrollTop = (si.top / max) * Math.max(1, previewPane.scrollHeight - previewPane.clientHeight);
    requestAnimationFrame(() => { scrollLock = null; });
  });
  previewPane.addEventListener("scroll", () => {
    if (scrollLock === "editor") return;
    scrollLock = "preview";
    const el = previewPane, si = cm.getScrollInfo();
    const max = Math.max(1, el.scrollHeight - el.clientHeight);
    cm.scrollTo(0, (el.scrollTop / max) * Math.max(1, si.height - si.clientHeight));
    requestAnimationFrame(() => { scrollLock = null; });
  });

  /* ---------------- image paste / drop ---------------- */
  const editorPane = $("#editor-pane");
  ["dragover", "drop"].forEach((ev) => editorPane.addEventListener(ev, (e) => e.preventDefault()));
  editorPane.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));
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

  /* ---------------- wormhole ---------------- */
  const modal = $("#wormhole-modal"), log = $("#wormhole-log"),
        codeBox = $("#wormhole-code"), copyBtn = $("#wormhole-copy");
  let whController = null;

  $("#btn-wormhole").addEventListener("click", startWormhole);
  $("#wormhole-cancel").addEventListener("click", () => {
    if (whController) whController.abort();
    modal.classList.add("hidden");
  });
  copyBtn.addEventListener("click", () => navigator.clipboard.writeText(codeBox.textContent.trim()));

  async function startWormhole() {
    modal.classList.remove("hidden");
    log.textContent = "Zipping vault and calling wormhole…\n";
    codeBox.classList.add("hidden"); copyBtn.classList.add("hidden");
    whController = new AbortController();
    try {
      const res = await fetch("/api/wormhole", { signal: whController.signal });
      const text = await readStream(res.body);
      if (!res.ok) log.textContent = text + "\n\nMake sure the magic-wormhole CLI is installed (see README).";
    } catch (e) {
      log.textContent += e.name === "AbortError" ? "\n[cancelled]" : "\n[error: " + e.message + "]";
    }
  }

  async function readStream(body) {
    const reader = body.getReader(), dec = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      log.textContent = text;
      log.scrollTop = log.scrollHeight;
      const m = text.match(/\b\d+(?:-[a-z0-9]+){2,}\b/i); // e.g. 7-crossover-clockwork
      if (m) {
        codeBox.textContent = "🔑 " + m[0];
        codeBox.classList.remove("hidden");
        copyBtn.classList.remove("hidden");
      }
    }
    return text;
  }

  /* ---------------- init ---------------- */
  function setStatus(msg) { statusEl.textContent = msg; }
  loadFileList();
})();
