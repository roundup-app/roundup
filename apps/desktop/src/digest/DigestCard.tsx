import { For, Show } from "solid-js";
import * as v from "valibot";
import type { DigestEntry } from "@contracts/agent/DigestEntry";
import { Markdown } from "../plain/Markdown";
import "./styles.css";

const prefix = "[digest] ";

const KINDS = ["error", "needs-you", "blocked", "working", "idle", "done"] as const;

const json = v.pipe(v.string(), v.parseJson());

const entrySchema = v.pipe(
  json,
  v.object({ name: v.string(), kind: v.picklist(KINDS), last: v.string(), todos: v.number(), pads: v.array(v.string()) }),
);

export type PushedDigest = { note: string | null; entries: readonly DigestEntry[]; more: string | null };

const entryOf = (line: string): DigestEntry | null => {
  const result = v.safeParse(entrySchema, line);

  return result.success ? result.output : null;
};

/**
 * What a pushed Digest's body carries (B21, B22): a plain push is one entry; a rollup or a merge has a header
 * line (`note`), an entry per line and a last `[+N more: …]` line. Null when the body is not a pushed Digest.
 */
export const digestOf = (body: string): PushedDigest | null => {
  if (!body.startsWith(prefix)) return null;

  const lines = body.split("\n");
  const head = lines[0]!.slice(prefix.length);

  if (head.startsWith("[")) {
    const entries = lines.slice(1).flatMap((line) => entryOf(line.startsWith(prefix) ? line.slice(prefix.length) : line) ?? []);
    const last = lines.at(-1)!;

    return { note: head, entries, more: lines.length > 1 && last.startsWith("[+") ? last : null };
  }

  const only = entryOf(body.slice(prefix.length));

  return only === null ? null : { note: null, entries: [only], more: null };
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
