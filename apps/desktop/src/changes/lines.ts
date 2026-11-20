/** U7675e: where a change begins, on the side that holds its first line. */
export type ChangeStart = { side: "old" | "new"; line: number };

/** The starts of the runs of added or removed lines in one hunk's body, from its first old and new line. */
const hunkStarts = (oldFrom: number, newFrom: number, body: readonly string[]): ChangeStart[] => {
  const starts: ChangeStart[] = [];
  let oldLine = oldFrom;
  let newLine = newFrom;
  let inRun = false;

  for (const text of body) {
    const mark = text[0] ?? " ";
    const changed = mark === "+" || mark === "-";

    if (changed && !inRun) starts.push(mark === "+" ? { side: "new", line: newLine } : { side: "old", line: oldLine });
    inRun = changed;

    if (mark !== "+") oldLine++;

    if (mark !== "-") newLine++;
  }

  return starts;
};

/** U7675e: the first line of each run of added or removed lines in a unified patch, in patch order. */
export const changeStarts = (patch: string): ChangeStart[] => {
  const hunks: { old: number; next: number; body: string[] }[] = [];

  for (const text of patch.split("\n")) {
    const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(text);

    if (head) hunks.push({ old: Number(head[1]), next: Number(head[2]), body: [] });
    else if (!text.startsWith("\\")) hunks.at(-1)?.body.push(text);
  }

  return hunks.flatMap(hunk => hunkStarts(hunk.old, hunk.next, hunk.body));
};

/** U7675d: one file's place in the diff: its scroll offset and focused line. */
export type Place = { scroll: number; selection: { side: "old" | "new"; start: number; end: number } };

/** U7675d, U7675f: each file's place, kept while the view is open and, per Agent, for the App's run. */
export type Places = { get: (path: string) => Place | undefined; set: (path: string, place: Place) => void; forget: (path: string) => void };

/** U7675f: the open file and every file's place for one Agent. */
export type Remembered = { open: string | undefined; places: Map<string, Place> };

const remembered = new Map<string, Remembered>();

/** U7675f: the place kept for `key`, made empty on first use. */
export const rememberedFor = (key: string): Remembered => {
  const found = remembered.get(key);

  if (found) return found;
  const made: Remembered = { open: undefined, places: new Map() };

  remembered.set(key, made);

  return made;
};

/** U7675d: the place a file opens at: the one kept for it, else its top and first line. */
export const placeOf = (places: Places | undefined, path: string): Place => places?.get(path) ?? { scroll: 0, selection: { side: "new", start: 1, end: 1 } };

/** The side's name in `@pierre/diffs`. */
export const sideName = (side: "old" | "new"): "deletions" | "additions" => side === "old" ? "deletions" : "additions";
