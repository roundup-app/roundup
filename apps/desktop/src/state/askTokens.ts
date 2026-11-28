/** U8045a: a token is `#` or `@` plus the non-space characters after it, starting the text or following a space. */
export type Token = { sigil: "#" | "@"; word: string; start: number; end: number };

const TOKEN = /(?<lead>^|\s)(?<sigil>[#@])(?<word>\S*)/g;

/** The longest of `names` that opens `rest` and ends at a space or the end of the text. */
const nameAt = (rest: string, names: readonly string[]): string | undefined =>
  names
    .filter(name => name.length > 0 && rest.slice(0, name.length).toLowerCase() === name.toLowerCase() && /^\s?$/.test(rest.charAt(name.length)))
    .reduce<string | undefined>((best, name) => (best === undefined || name.length > best.length ? name : best), undefined);

/** `names` are the open Projects (`#`) and Workstreams (`@`): a token takes the longest of them that follows its sigil, else the non-space run. */
export const tokensOf = (text: string, names: { "#"?: readonly string[]; "@"?: readonly string[] } = {}): Token[] =>
  [...text.matchAll(TOKEN)].flatMap(found => {
    const { lead = "", sigil, word = "" } = found.groups ?? {};

    if (sigil !== "#" && sigil !== "@") return [];
    const start = found.index + lead.length;
    const rest = text.slice(start + 1);
    const taken = nameAt(rest, names[sigil] ?? []) ?? word;

    return [{ sigil, word: taken, start, end: start + 1 + taken.length }];
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
  const named = tokensOf(text, { "#": projects }).filter(token => token.sigil === "#").flatMap(token => projectNamed(token.word, projects) ?? []);

  return [...new Set(named)];
};

export type Segment = { text: string; mark?: "project" | "workstream" };

/** U8045b: the text cut into plain runs and set tokens; a token naming neither an open Project nor a Workstream stays plain. */
export const segments = (text: string, projects: readonly string[], workstreams: readonly string[]): Segment[] => {
  const out: Segment[] = [];
  let at = 0;

  for (const token of tokensOf(text, { "#": projects, "@": workstreams })) {
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

/** U8045c: a part placed in a new Workstream without a Project takes the one `#` names inside its own text, else the first named. */
export const withNamedProjects = <P extends { text: string; placement: { kind: string; project?: string } }>(placed: readonly P[], named: readonly string[]): P[] =>
  placed.map(part => {
    const chosen = hashProjects(part.text, named)[0] ?? named[0];

    return part.placement.kind === "new" && !part.placement.project && chosen ? { ...part, placement: { ...part.placement, project: chosen } } : part;
  });
