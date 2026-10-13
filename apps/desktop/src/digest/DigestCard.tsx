import { For, Show } from "solid-js";
import type { DigestEntry } from "@contracts/agent/DigestEntry";
import { Markdown } from "../plain/Markdown";
import "./styles.css";

const prefix = "[digest] ";

const KINDS = ["error", "needs-you", "blocked", "working", "idle", "done"] as const;

const HEAD = /^([^ [].*) is (\S+)$/;

export type PushedDigest = { note: string | null; entries: readonly DigestEntry[]; more: string | null };

/** B33: the entry whose first line is `head` (`<name> is <kind>`) and whose indented lines are `rest`; null when `head` is none. */
const entryOf = (head: string, rest: readonly string[]): DigestEntry | null => {
  const found = HEAD.exec(head);
  const kind = KINDS.find((word) => word === found?.[2]);

  if (found === null || kind === undefined) return null;

  const entry: DigestEntry = {
    name: found[1]!,
    kind,
    last: "",
    todos: 0,
    pads: [],
  };

  for (const line of rest) {
    if (line.startsWith("  last: ")) entry.last = line.slice("  last: ".length);
    else if (line.startsWith("  open todos: ")) entry.todos = Number(line.slice("  open todos: ".length)) || 0;
    else if (line.startsWith("  pads: ")) entry.pads = line.slice("  pads: ".length).split(", ");
  }

  return entry;
};

/**
 * What a pushed Digest's body carries (B21, B22, B33): a plain push is one entry in the lines `<name> is <kind>`, `  last: …`,
 * `  open todos: …` and `  pads: …`; a rollup or a merge has a header line (`note`), an entry block per child and a last
 * `[+N more: …]` line. Null when the body is not a pushed Digest.
 */
export const digestOf = (body: string): PushedDigest | null => {
  if (!body.startsWith(prefix)) return null;

  const lines = body.split("\n");
  const head = lines[0]!.slice(prefix.length);
  const entries: DigestEntry[] = [];
  let at = head.startsWith("[") ? 1 : 0;

  while (at < lines.length) {
    const first = lines[at]!.startsWith(prefix) ? lines[at]!.slice(prefix.length) : lines[at]!;
    const rest: string[] = [];

    at += 1;

    while (at < lines.length && lines[at]!.startsWith("  ")) rest.push(lines[at++]!);

    const entry = entryOf(first, rest);

    if (entry !== null) entries.push(entry);
  }

  if (head.startsWith("[")) {
    const last = lines.at(-1)!;

    return { note: head, entries, more: lines.length > 1 && last.startsWith("[+") ? last : null };
  }

  return entries.length === 0 ? null : { note: null, entries: [entries[0]!], more: null };
};

/** The Digest a Door was pushed about one child (B22): its name and Kind, its last line, its open Todos and its Pads. */
const EntryCard = (props: { entry: DigestEntry }) => (
  <section class="digest-card" aria-label={`Digest of ${props.entry.name}`}>
    <p class="digest-title">
      <span>{props.entry.name}</span> <span class="light">{props.entry.kind}</span>
    </p>
    <Markdown class="digest-last" body={props.entry.last} />
    <p class="light">{props.entry.todos === 1 ? "1 open todo" : `${props.entry.todos} open todos`}</p>
    <Show when={props.entry.pads.length > 0}>
      <ul class="digest-pads">
        <For each={props.entry.pads}>{(pad) => <li>{pad}</li>}</For>
      </ul>
    </Show>
  </section>
);

/** A pushed Digest as Digest Cards, with the count of updates a rollup or merge stands for, and the children left out. */
export const DigestCards = (props: { digest: PushedDigest }) => (
  <>
    <Show when={props.digest.note}>{(note) => <p class="light digest-note">{note()}</p>}</Show>
    <For each={props.digest.entries}>{(entry) => <EntryCard entry={entry} />}</For>
    <Show when={props.digest.more}>{(more) => <p class="light digest-note">{more()}</p>}</Show>
  </>
);

export const DigestCard = EntryCard;
