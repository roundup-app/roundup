/** U8045a: a token is `#` or `@` plus the non-space characters after it, starting the text or following a space. */
export type Token = { sigil: "#" | "@"; word: string; start: number; end: number };

const TOKEN = /(?<lead>^|\s)(?<sigil>[#@])(?<word>\S*)/g;

export const tokensOf = (text: string): Token[] =>
  [...text.matchAll(TOKEN)].flatMap(found => {
    const { lead = "", sigil, word = "" } = found.groups ?? {};

    if (sigil !== "#" && sigil !== "@") return [];
    const start = found.index + lead.length;

    return [{ sigil, word, start, end: start + 1 + word.length }];
  });

/** The token being typed: the one the caret sits in or at the end of. */
export const tokenAt = (text: string, caret: number): Token | null =>
  tokensOf(text).find(token => caret > token.start && caret <= token.end) ?? null;

/** Writes `replacement` in place of `token`, leaving the text around it, and says where the caret goes. */
export const replaceToken = (text: string, token: Token, replacement: string) => {
  const after = text.slice(token.end);
  const tail = after.startsWith(" ") ? after.slice(1) : after;

  return { text: text.slice(0, token.start) + replacement + tail, caret: token.start + replacement.length };
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The open Project a `#` token names exactly, ignoring case. */
export const projectNamed = (word: string, projects: readonly string[]): string | undefined => projects.find(name => same(name, word));

/** The distinct open Projects the text names with `#`, in the order first named. */
export const hashProjects = (text: string, projects: readonly string[]): string[] => {
  const named = tokensOf(text).filter(token => token.sigil === "#").flatMap(token => projectNamed(token.word, projects) ?? []);

  return [...new Set(named)];
};

export type Segment = { text: string; mark?: "project" | "workstream" };

/** U8045b: the text cut into plain runs and set tokens; a token naming neither an open Project nor a Workstream stays plain. */
export const segments = (text: string, projects: readonly string[], workstreams: readonly string[]): Segment[] => {
  const out: Segment[] = [];
  let at = 0;

  for (const token of tokensOf(text)) {
    const mark = token.sigil === "#"
      ? (projectNamed(token.word, projects) ? "project" : undefined)
      : (workstreams.some(name => same(name, token.word)) ? "workstream" : undefined);

    if (!mark) continue;

    if (token.start > at) out.push({ text: text.slice(at, token.start) });
    out.push({ text: text.slice(token.start, token.end), mark });
    at = token.end;
  }

  if (at < text.length) out.push({ text: text.slice(at) });

  return out;
};
