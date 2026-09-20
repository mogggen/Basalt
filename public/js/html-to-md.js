/* Convert pasted HTML to Obsidian-flavoured markdown. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.htmlToMarkdown = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function decodeEntities(s) {
    return String(s)
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
  }

  function stripTags(s) {
    return decodeEntities(s.replace(/<[^>]+>/g, ""));
  }

  function convertInline(s) {
    s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
    s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
    s = s.replace(/<(s|strike|del)\b[^>]*>([\s\S]*?)<\/\1>/gi, "~~$2~~");
    s = s.replace(/<u\b[^>]*>([\s\S]*?)<\/u>/gi, "<u>$1</u>");
    s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => "`" + stripTags(t) + "`");
    s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) =>
      `[${stripTags(t) || href}](${href})`);
    s = s.replace(/<img\b[^>]*>/gi, (tag) => {
      const src = /src=["']([^"']+)["']/i.exec(tag);
      const alt = /alt=["']([^"']*)["']/i.exec(tag);
      return src ? `![${alt ? alt[1] : ""}](${src[1]})` : "";
    });
    s = s.replace(/<br\s*\/?>/gi, "\n");
    return s;
  }

  function convertTable(html) {
    const rows = [];
    html.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) => {
      const cells = [];
      row.replace(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi, (__, cell) => {
        cells.push(stripTags(convertInline(cell)).replace(/\|/g, "\\|").trim());
        return "";
      });
      if (cells.length) rows.push(cells);
      return "";
    });
    if (!rows.length) return "";
    const width = Math.max(...rows.map((r) => r.length));
    const norm = rows.map((r) => {
      const copy = r.slice();
      while (copy.length < width) copy.push("");
      return copy;
    });
    const header = "| " + norm[0].join(" | ") + " |";
    const sep = "| " + norm[0].map(() => "---").join(" | ") + " |";
    const body = norm.slice(1).map((r) => "| " + r.join(" | ") + " |").join("\n");
    return header + "\n" + sep + (body ? "\n" + body : "");
  }

  function convertList(html, ordered) {
    const items = [];
    html.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, item) => {
      items.push(stripTags(convertInline(item)).replace(/\s+/g, " ").trim());
      return "";
    });
    return items.map((t, i) => (ordered ? `${i + 1}. ${t}` : `- ${t}`)).join("\n");
  }

  return function htmlToMarkdown(html) {
    if (!html || typeof html !== "string") return "";
    let s = html.replace(/\r\n?/g, "\n");
    const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(s);
    if (body) s = body[1];
    s = s.replace(/<!--[\s\S]*?-->/g, "");
    s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
    s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
    s = s.replace(/<\/?(meta|link|xml|o:p)[^>]*>/gi, "");

    s = s.replace(/<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, t) =>
      "\n```\n" + decodeEntities(t.replace(/<[^>]+>/g, "")) + "\n```\n");
    s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, t) =>
      "\n```\n" + decodeEntities(t.replace(/<[^>]+>/g, "")) + "\n```\n");
    s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) =>
      "\n" + "#".repeat(Number(n)) + " " + stripTags(convertInline(t)).trim() + "\n");
    s = s.replace(/<table\b[\s\S]*?<\/table>/gi, (t) => "\n" + convertTable(t) + "\n");
    s = s.replace(/<ol\b[\s\S]*?<\/ol>/gi, (t) => "\n" + convertList(t, true) + "\n");
    s = s.replace(/<ul\b[\s\S]*?<\/ul>/gi, (t) => "\n" + convertList(t, false) + "\n");
    s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) =>
      "\n" + stripTags(convertInline(t)).trim().split("\n").map((l) => "> " + l).join("\n") + "\n");
    s = s.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => "\n" + convertInline(t) + "\n");
    s = s.replace(/<div\b[^>]*>([\s\S]*?)<\/div>/gi, (_, t) => "\n" + convertInline(t) + "\n");
    s = convertInline(s);
    s = s.replace(/<\/?(span|font|section|article|header|footer)[^>]*>/gi, "");
    s = s.replace(/<[^>]+>/g, (tag) => /^<\/?u\b/i.test(tag) ? tag : "");
    s = decodeEntities(s);
    s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return s;
  };
});
