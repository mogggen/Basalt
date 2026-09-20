// Copies browser-ready files from node_modules into public/vendor
const fs = require("fs");
const path = require("path");

const nm = (...p) => path.join(__dirname, "..", "node_modules", ...p);
const out = path.join(__dirname, "..", "public", "vendor");

function copy(src, rel) {
  const dest = path.join(out, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log("vendored:", path.relative(process.cwd(), dest));
}

copy(nm("codemirror", "lib", "codemirror.js"), "codemirror/codemirror.js");
copy(nm("codemirror", "lib", "codemirror.css"), "codemirror/codemirror.css");
copy(nm("codemirror", "mode", "markdown", "markdown.js"), "codemirror/mode-markdown.js");
copy(nm("codemirror", "mode", "javascript", "javascript.js"), "codemirror/mode-javascript.js");
copy(nm("codemirror", "mode", "xml", "xml.js"), "codemirror/mode-xml.js");
copy(nm("codemirror", "addon", "edit", "continuelist.js"), "codemirror/continuelist.js");
copy(nm("codemirror", "addon", "edit", "closebrackets.js"), "codemirror/closebrackets.js");
copy(nm("codemirror", "addon", "selection", "active-line.js"), "codemirror/active-line.js");
copy(nm("codemirror", "addon", "display", "placeholder.js"), "codemirror/placeholder.js");
copy(nm("codemirror", "addon", "dialog", "dialog.js"), "codemirror/dialog.js");
copy(nm("codemirror", "addon", "dialog", "dialog.css"), "codemirror/dialog.css");
copy(nm("codemirror", "addon", "search", "searchcursor.js"), "codemirror/searchcursor.js");
copy(nm("codemirror", "keymap", "vim.js"), "codemirror/vim.js");
copy(nm("mermaid", "dist", "mermaid.min.js"), "mermaid/mermaid.min.js");
copy(nm("highlight.js", "styles", "github-dark.css"), "highlight/github-dark.css");

console.log("done.");
