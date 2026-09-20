/* Find markdown blocks that can be replaced with live previews. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else Object.assign(root, factory());
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function findPreviewBlocks(text) {
    if (typeof text !== "string") return [];
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

  function indexToLineCh(text, index) {
    let line = 0, ch = 0;
    for (let i = 0; i < index && i < text.length; i++) {
      if (text[i] === "\n") { line++; ch = 0; }
      else ch++;
    }
    return { line, ch };
  }

  function inFence(blocks, line) {
    return blocks.some((b) => (b.type === "code" || b.type === "mermaid") && line >= b.from && line <= b.to);
  }

  function findUnderlineSpans(text) {
    const blocks = findPreviewBlocks(text);
    const spans = [];
    const re = /<u\b[^>]*>([\s\S]*?)<\/u>/gi;
    let m;
    while ((m = re.exec(text))) {
      const start = m.index;
      const innerStart = start + m[0].indexOf(">") + 1;
      const innerEnd = start + m[0].length - 4;
      const openEnd = innerStart;
      const closeStart = innerEnd;
      const from = indexToLineCh(text, start);
      if (inFence(blocks, from.line)) continue;
      spans.push({
        from,
        to: indexToLineCh(text, start + m[0].length),
        openFrom: from,
        openTo: indexToLineCh(text, openEnd),
        closeFrom: indexToLineCh(text, closeStart),
        closeTo: indexToLineCh(text, start + m[0].length),
        innerFrom: indexToLineCh(text, innerStart),
        innerTo: indexToLineCh(text, innerEnd),
      });
    }
    return spans;
  }

  function widgetSignature(blocks, selections) {
    const hidden = blocks.filter((b) => !selections.some((s) => {
      const a = s.anchor || s.head, c = s.head || s.anchor;
      const lo = Math.min(a.line, c.line), hi = Math.max(a.line, c.line);
      return !(hi < b.from || lo > b.to);
    }));
    return hidden.map((b) => b.type + ":" + b.from + "-" + b.to).join("|");
  }

  return { findPreviewBlocks, findUnderlineSpans, widgetSignature, indexToLineCh };
});
