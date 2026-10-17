import type { TurnFacts } from "./turns";

/** U515: the note holds one line of context, and the Excerpt stays below B1's 8 192-byte body bound once the note and facts are added. */
export const NOTE_MAX = 280;

const EXCERPT_MAX_BYTES = 6000;

const BODY_MAX_BYTES = 8192;

const FACT_MAX_CHARS = 300;

const encoder = new TextEncoder();

const bytes = (text: string): number => encoder.encode(text).length;

/** The last `limit` bytes of `text`, starting on a character boundary. */
const tail = (text: string, limit: number): string => {
  const all = encoder.encode(text);

  if (all.length <= limit) return text;

  let from = all.length - Math.max(limit, 0);

  while (from < all.length && ((all[from] ?? 0) & 0xc0) === 0x80) from += 1;

  return new TextDecoder().decode(all.subarray(from));
};

/**
 * The selection as the Agent receives it: each row without trailing blanks, at most `limit` bytes. A longer text keeps
 * its end under a first line `[… N lines cut]`, N counting every line the cut touched. Null when the text is blank.
 */
export const excerptOf = (selection: string, limit: number = EXCERPT_MAX_BYTES): string | null => {
  const text = selection.split(/\r?\n/).map((row) => row.trimEnd()).join("\n").replace(/^\n+|\s+$/g, "");

  if (text.trim() === "") return null;

  if (bytes(text) <= limit) return text;

  const room = limit - bytes(`[… ${text.split("\n").length} lines cut]\n`);
  const kept = tail(text, room);
  const cut = text.slice(0, text.length - kept.length).split("\n").length;

  return `[… ${cut} lines cut]\n${kept}`;
};

/** Three backticks, or one more than the longest run inside `text`. */
const fenceOf = (text: string): string => "`".repeat(Math.max(3, Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length)) + 1));

const short = (value: string): string => value.length > FACT_MAX_CHARS ? `${value.slice(0, FACT_MAX_CHARS)}…` : value;

const factsOf = (facts: TurnFacts | null): string[] =>
  facts === null ? [] : [
    ...(facts.command === null ? [] : [`command: ${short(facts.command.replace(/\s*\n\s*/g, " "))}`]),
    ...(facts.cwd === null ? [] : [`cwd: ${short(facts.cwd)}`]),
    ...(facts.exit === null ? [] : [`exit: ${facts.exit}`]),
  ];

/**
 * U516: the note and a blank line when a note exists, the Excerpt fenced, then a blank line and the facts a Turn knows.
 * The Excerpt is cut again from its start in the one case the fences and facts push the body over B1's bound.
 */
export const bodyOf = (note: string, selection: string, facts: TurnFacts | null): string | null => {
  const lines = factsOf(facts);
  const head = note.trim() === "" ? "" : `${note.trim()}\n\n`;
  let limit = EXCERPT_MAX_BYTES;

  for (;;) {
    const excerpt = excerptOf(selection, limit);

    if (excerpt === null) return null;

    const fence = fenceOf(excerpt);
    const body = `${head}${fence}\n${excerpt}\n${fence}${lines.length === 0 ? "" : `\n\n${lines.join("\n")}`}`;
    const over = bytes(body) - BODY_MAX_BYTES;

    if (over <= 0 || limit <= over) return body;

    limit -= over;
  }
};
