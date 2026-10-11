export type Block = { kind: "text"; text: string } | { kind: "code"; text: string } | { kind: "table"; head: string[]; rows: string[][] };

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);

const isRule = (line: string) => isRow(line) && cells(line).every((cell) => /^:?-{1,}:?$/.test(cell));

/** Q3: the parts of one line of text, a `code` span between backticks apart from the rest. */
export const spansOf = (text: string): { code: boolean; text: string }[] =>
  text.split(/(`[^`\n]+`)/).filter((part) => part !== "").map((part) => (/^`[^`\n]+`$/.test(part) ? { code: true, text: part.slice(1, -1) } : { code: false, text: part }));

/** Q3: hold:Plain's status reply is rows under a header; a header, a rule line and the rows after it are a table, the rest is text. */
export const blocksOf = (body: string): Block[] => {
  const lines = body.split("\n");
  const blocks: Block[] = [];

  let text: string[] = [];

  const flush = () => {
    if (text.length > 0) blocks.push({ kind: "text", text: text.join("\n") });

    text = [];
  };

  for (let at = 0; at < lines.length; at++) {
    if (/^\s*```/.test(lines[at]!) && lines.slice(at + 1).some((line) => /^\s*```\s*$/.test(line))) {
      flush();
      const code: string[] = [];
      at++;

      while (!/^\s*```\s*$/.test(lines[at]!)) code.push(lines[at++]!);

      blocks.push({ kind: "code", text: code.join("\n") });
    } else if (isRow(lines[at]!) && at + 1 < lines.length && isRule(lines[at + 1]!)) {
      flush();
      const head = cells(lines[at]!);
      const rows: string[][] = [];
      at += 2;

      while (at < lines.length && isRow(lines[at]!)) rows.push(cells(lines[at++]!));

      at--;

      blocks.push({ kind: "table", head, rows });
    } else text.push(lines[at]!);
  }

  flush();

  return blocks;
};

/** Q3: whether `body` holds a table or code, which only `PlainText` lays out. */
export const hasLayout = (body: string) => blocksOf(body).some((block) => block.kind !== "text") || spansOf(body).some((span) => span.code);
