
/** Markdown → HTML: GFM tables, mermaid passthrough, highlight.js code. */
const { marked } = require("marked");
const hljs = require("highlight.js");

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

marked.setOptions({ gfm: true, breaks: true }); // breaks:true ≈ Obsidian's soft line breaks
marked.use({
  renderer: {
    // Handles both classic (code, infostring) and token-object renderer signatures
    code(codeOrToken, infostring) {
      let code, lang;
      if (codeOrToken && typeof codeOrToken === "object") {
        code = codeOrToken.text ?? "";
        lang = String(codeOrToken.lang || "").trim().split(/\s+/)[0];
      } else {
        code = String(codeOrToken ?? "");
        lang = String(infostring || "").trim().split(/\s+/)[0];
      }

      if (lang.toLowerCase() === "mermaid") {
        // Raw passthrough; the browser renders it with mermaid.js
        return `<pre class="mermaid-source"><code class="language-mermaid">${escapeHtml(code)}</code></pre>`;
      }
      if (lang && hljs.getLanguage(lang)) {
        let html;
        try { html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; }
        catch { html = escapeHtml(code); }
        return `<pre><code class="hljs language-${escapeHtml(lang)}">${html}</code></pre>`;
      }
      let html;
      try { html = lang ? escapeHtml(code) : (code.length < 10000 ? hljs.highlightAuto(code).value : escapeHtml(code)); }
      catch { html = escapeHtml(code); }
      return `<pre><code class="hljs">${html}</code></pre>`;
    },
  },
});

module.exports = function renderMarkdown(md) {
  try {
    return marked.parse(md ?? "");
  } catch (e) {
    return `<p class="render-error">Render error: ${escapeHtml(e.message)}</p>`;
  }
};