export const menuBarCopy = {
  waiting: "Waiting",
  ready: "Ready",
  empty: "Nothing for you",
  open: "Open roundup",
  more: (count: number) => `${count} more…`,
  /** @prose */
  row: (glyph: string, name: string, project: string | null, live: string) => `${glyph} ${name}${project === null ? "" : ` · ${project}`} · ${live}`,
};
