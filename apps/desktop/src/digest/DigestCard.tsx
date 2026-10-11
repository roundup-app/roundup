import { For, Show } from "solid-js";
import * as v from "valibot";
import type { DigestEntry } from "@contracts/agent/DigestEntry";
import "./styles.css";

const prefix = "[digest] ";

const KINDS = ["error", "needs-you", "blocked", "working", "idle", "done"] as const;

const json = v.pipe(v.string(), v.parseJson());

const entrySchema = v.pipe(
  json,
  v.object({ name: v.string(), kind: v.picklist(KINDS), last: v.string(), todos: v.number(), pads: v.array(v.string()) }),
);

/** The entry a pushed Digest's body carries (B21), or null when the body is not a pushed Digest. */
export const digestOf = (body: string): DigestEntry | null => {
  if (!body.startsWith(prefix)) return null;

  const result = v.safeParse(entrySchema, body.slice(prefix.length));

  return result.success ? result.output : null;
};

/** The Digest a Door was pushed about one child (B22): its name and Kind, its last line, its open Todos and its Pads. */
export const DigestCard = (props: { entry: DigestEntry }) => (
  <section class="digest-card" aria-label={`Digest of ${props.entry.name}`}>
    <p class="digest-title">
      <span>{props.entry.name}</span> <span class="light">{props.entry.kind}</span>
    </p>
    <p class="digest-last">{props.entry.last}</p>
    <p class="light">{props.entry.todos === 1 ? "1 open todo" : `${props.entry.todos} open todos`}</p>
    <Show when={props.entry.pads.length > 0}>
      <ul class="digest-pads">
        <For each={props.entry.pads}>{(pad) => <li>{pad}</li>}</For>
      </ul>
    </Show>
  </section>
);
