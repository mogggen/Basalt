// Copies browser-ready files from node_modules into public/vendor
const fs = require("fs");
const path = require("path");

const nm = (...p) => path.join(__dirname, "..", "node_modules", ...p);
const out = path.join(__dirname, "..", "public", "vendor");

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log("vendored:", path.relative(process.cwd(), dest));
}

copy(nm("codemirror", "lib", "codemirror.js"),               out, "codemirror/codemirror.js");
copy(nm("codemirror", "lib", "codemirror.css"),              out, "codemirror/codemirror.css");
copy(nm("codemirror", "mode", "markdown", "markdown.js"),    out, "codemirror/mode-markdown.js");
copy(nm("codemirror", "mode", "javascript", "javascript.js"),out, "codemirror/mode-javascript.js");
copy(nm("codemirror", "mode", "xml", "xml.js"),              out, "codemirror/mode-xml.js");
copy(nm("codemirror", "addon", "edit", "continuelist.js"),   out, "codemirror/continuelist.js");
copy(nm("codemirror", "addon", "edit", "closebrackets.js"),  out, "codemirror/closebrackets.js");
copy(nm("codemirror", "addon", "selection", "active-line.js"), out, "codemirror/active-line.js");
copy(nm("codemirror", "addon", "display", "placeholder.js"), out, "codemirror/placeholder.js");
copy(nm("mermaid", "dist", "mermaid.min.js"),                out, "mermaid/mermaid.min.js");
copy(nm("highlight.js", "styles", "github-dark.css"),        out, "highlight/github-dark.css");

console.log("done.");