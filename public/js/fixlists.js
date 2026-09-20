
/* Fix ordered-list numbering in markdown source.
 * "1. / 5. / 9." → "1. / 2. / 3." per list level, starting from each
 * list's first number. Preserves "." vs ")". Skips fenced code blocks.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.fixOrderedLists = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const FENCE_RE  = /^(\s*)(`{3,}|~{3,})/;
  const ITEM_RE   = /^(\s*)(\d{1,9})([.)])(\s|$)/;
  const BULLET_RE = /^(\s*)([-*+])(\s|$)/;

  function indentWidth(ws) {
    let w = 0;
    for (const c of ws) w += c === "\t" ? 4 - (w % 4) : 1;
    return w;
  }

  return function fixOrderedLists(md) {
    if (typeof md !== "string") return md;
    const lines = md.split(/\r?\n/);
    const out = [];
    const levels = []; // { indent, next, marker }
    let inFence = false, fenceChar = "", fenceLen = 0;

    for (const line of lines) {
      const fm = line.match(FENCE_RE);
      if (fm) {
        const ch = fm[2].charAt(0), len = fm[2].length;
        if (!inFence) { inFence = true; fenceChar = ch; fenceLen = len; }
        else if (ch === fenceChar && len >= fenceLen) inFence = false;
        out.push(line); continue;
      }
      if (inFence) { out.push(line); continue; }

      const om = line.match(ITEM_RE);
      if (om) {
        const ind = indentWidth(om[1]);
        while (levels.length && levels[levels.length - 1].indent > ind) levels.pop();
        if (!levels.length || levels[levels.length - 1].indent < ind) {
          levels.push({ indent: ind, next: parseInt(om[2], 10) + 1, marker: om[3] });
        } else {
          levels[levels.length - 1].marker = om[3];
        }
        const lvl = levels[levels.length - 1];
        const rest = line.slice(om[0].length);
        out.push(om[1] + (lvl.next - 1) + lvl.marker + (rest ? " " + rest : ""));
        lvl.next += 1;
        continue;
      }

      const bm = line.match(BULLET_RE);
      if (bm) {
        const bind = indentWidth(bm[1]);
        while (levels.length && levels[levels.length - 1].indent >= bind) levels.pop();
        out.push(line); continue;
      }

      if (line.trim() === "") { out.push(line); continue; }
      const tind = indentWidth(line.match(/^\s*/)[0]);
      if (levels.length && tind < levels[levels.length - 1].indent + 2) levels.length = 0;
      out.push(line);
    }
    return out.join("\n");
  };
});