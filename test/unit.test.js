const test = require("node:test");
const assert = require("node:assert/strict");
const fixOrderedLists = require("../public/js/fixlists");
const htmlToMarkdown = require("../public/js/html-to-md");
const { findPreviewBlocks, findUnderlineSpans, widgetSignature } = require("../public/js/preview-blocks");

test("fixOrderedLists rewrites a simple list", () => {
  const src = "1. a\n5. b\n9. c\n";
  assert.equal(fixOrderedLists(src), "1. a\n2. b\n3. c\n");
});

test("fixOrderedLists leaves fenced code alone", () => {
  const src = "```\n1. nope\n5. still\n```\n";
  assert.equal(fixOrderedLists(src), src);
});

test("fixOrderedLists is idempotent", () => {
  const src = "1. a\n2. b\n   1. nested\n   4. nested2\n3. c";
  const once = fixOrderedLists(src);
  assert.equal(fixOrderedLists(once), once);
});

test("htmlToMarkdown converts common rich-text paste", () => {
  const html = "<p>Hello <b>bold</b> and <i>italic</i> and <u>under</u> and <s>gone</s></p>";
  assert.equal(htmlToMarkdown(html), "Hello **bold** and *italic* and <u>under</u> and ~~gone~~");
});

test("htmlToMarkdown converts links, images, lists, headings", () => {
  const html = "<h1>Title</h1><ul><li>one</li><li>two</li></ul><p><a href=\"https://x.test\">x</a></p><img src=\"pic.png\" alt=\"p\">";
  const md = htmlToMarkdown(html);
  assert.match(md, /^# Title/m);
  assert.match(md, /^- one/m);
  assert.match(md, /\[x\]\(https:\/\/x\.test\)/);
  assert.match(md, /!\[p\]\(pic\.png\)/);
});

test("htmlToMarkdown converts a table", () => {
  const html = "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>";
  const md = htmlToMarkdown(html);
  assert.match(md, /\| A \| B \|/);
  assert.match(md, /\| --- \| --- \|/);
  assert.match(md, /\| 1 \| 2 \|/);
});

test("findPreviewBlocks finds image, table, mermaid, and code", () => {
  const md = [
    "intro",
    "![alt](https://example.com/a.png)",
    "",
    "| A | B |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "```mermaid",
    "graph LR; A-->B",
    "```",
    "",
    "```js",
    "const x = 1;",
    "```",
  ].join("\n");
  const blocks = findPreviewBlocks(md);
  assert.deepEqual(blocks.map((b) => b.type), ["image", "table", "mermaid", "code"]);
});

test("findUnderlineSpans skips fenced code", () => {
  const md = "hi <u>yes</u>\n```\n<u>no</u>\n```\n";
  const spans = findUnderlineSpans(md);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].from.line, 0);
});

test("widgetSignature hides blocks the cursor is not on", () => {
  const blocks = [{ type: "image", from: 2, to: 2 }, { type: "table", from: 4, to: 6 }];
  const onImage = widgetSignature(blocks, [{ anchor: { line: 2, ch: 0 }, head: { line: 2, ch: 1 } }]);
  const elsewhere = widgetSignature(blocks, [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }]);
  assert.equal(onImage, "table:4-6");
  assert.equal(elsewhere, "image:2-2|table:4-6");
});
