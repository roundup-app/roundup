// Reuse: marked 16.4.2 (pinned; latest 18.1.1, modified 2026-10-12) renders GFM to HTML through the renderer overrides below.
// Milkdown's remark-parse/remark-gfm stop at mdast: HTML needs mdast-util-to-hast plus a sanitizer, neither a direct dependency.
import { Marked, type Tokens } from "marked";
import { foldClosing, foldOpening } from "./fold";

const safeTarget = /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i;

const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const attribute = (name: string, value: string) => ` ${name}="${escaped(value)}"`;

const markdown = new Marked({ gfm: true, breaks: false });

markdown.use({
  renderer: {
    // Q10: an Agent's HTML is shown as text, never as markup.
    html: ({ text }: Tokens.HTML | Tokens.Tag) => escaped(text),
    // Q10: only a web, mail or relative target keeps its `href`; `javascript:` shows the text alone.
    link({ href, title, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens);

      if (!safeTarget.test(href.trim())) return text;

      return `<a href="${escaped(href)}"${title ? attribute("title", title) : ""} rel="noreferrer noopener" target="_blank">${text}</a>`;
    },
    // An image is not drawn from generated text: it shows its alt text.
    image: ({ text }: Tokens.Image) => escaped(text),
  },
  // U7312a: a fold renders closed, its summary as text and its body as Markdown; one holding a second `<details>` stays text, as in a Pad (U5561).
  extensions: [{
    name: "fold",
    level: "block",
    start: (src: string) => src.match(/^<details>/m)?.index,
    tokenizer(src: string) {
      const lines = src.split("\n");
      const label = foldOpening.exec(lines[0] ?? "")?.[1];

      if (label === undefined) return undefined;
      const end = lines.findIndex((line, at) => at > 0 && foldClosing.test(line));
      const body = lines.slice(1, end).join("\n");

      if (end < 0 || body.includes("<details>")) return undefined;

      return { type: "fold", raw: lines.slice(0, end + 1).join("\n"), label, tokens: this.lexer.blockTokens(body, []) };
    },
    renderer(token: Tokens.Generic) {
      return `<details data-pad-agents><summary>${escaped(String(token["label"]))}</summary>${this.parser.parse(token.tokens ?? [])}</details>`;
    },
  }],
});

const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);

/** A table ends at the first line that is not a `|` row, as an Agent writing "Next: wait." under its rows means; GFM would read that line as one more row. */
const endTables = (body: string): string => {
  let fenced = false;
  let inTable = false;

  return body
    .split("\n")
    .flatMap((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;

      const ends = !fenced && inTable && line.trim() !== "" && !isRow(line);

      inTable = !fenced && isRow(line);

      return ends ? ["", line] : [line];
    })
    .join("\n");
};

/** Q10: the HTML of the Markdown an Agent wrote, the one renderer of every surface of Q2. */
export const renderMarkdown = (body: string): string => markdown.parse(endTables(body), { async: false }).trim();
