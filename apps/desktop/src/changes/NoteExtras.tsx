import { For, Show } from "solid-js";
import { copy } from "./copy";
import { LABELS } from "./notes";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { Label, Note, NoteFormDraft } from "./notes";

/** U7690a, U7690b: a note's label and replacement while it is written: null while unset. */
export type Extras = { label: Label | null; replacement: string | null };

type Range = Pick<NoteFormDraft, "side" | "start" | "end">;

/** The inclusive lines a range names, as the note retains them. */
export const sourceOf = (comparison: FileComparison, range: Range) => {
  const content = comparison[range.side];

  if (content.kind !== "text" || content.text === "") return "";
  const result = content.text.split("\n");

  if (result.at(-1) === "") result.pop();

  return result.slice(Number(range.start) - 1, Number(range.end)).join("\n");
};

/** What a draft or a saved note holds of them, only when set. */
export const optionalOf = (extras: Extras) => {
  const picked: Pick<Note, "label" | "replacement"> = {};

  if (extras.label !== null) picked.label = extras.label;

  if (extras.replacement !== null) picked.replacement = extras.replacement;

  return picked;
};

export const extrasOf = (...from: (Pick<Note, "label" | "replacement"> | undefined)[]): Extras => ({ label: from.find(each => each?.label !== undefined)?.label ?? null, replacement: from.find(each => each?.replacement !== undefined)?.replacement ?? null });

const MOVES = ["side", "start", "end"];

/** A change to the fields: an unedited fill follows the range; the old side has no lines to replace. */
export const changed = <T extends Range & Extras>(comparison: FileComparison, before: T, change: Partial<T>): T => {
  const after = { ...before, ...change };

  if (before.replacement === null || !MOVES.some(key => key in change)) return after;

  if (after.side === "old") return { ...after, replacement: null };

  return { ...after, replacement: before.replacement === sourceOf(comparison, before) ? sourceOf(comparison, after) : after.replacement };
};

/** A fill left unchanged is no suggestion. */
export const suggestionOf = (comparison: FileComparison, fields: Range & Extras) => fields.side === "new" && fields.replacement !== null && fields.replacement !== sourceOf(comparison, fields) ? fields.replacement : null;

export const sameExtras = (left: Extras, right: Extras) => left.label === right.label && left.replacement === right.replacement;

/** U7690a: the label group, then U7690b's button; the field it opens sits under the note's text. */
export const LabelRow = (props: { fields: Range & Extras; comparison: FileComparison; edit: (change: Partial<Extras>) => void }) => <>
  <div role="group" aria-label={copy.label} class="note-label">
    <For each={LABELS}>{each => <button type="button" data-button="quiet" aria-pressed={props.fields.label === each ? "true" : "false"} onClick={() => props.edit({ label: props.fields.label === each ? null : each })}>{copy.labels[each]}</button>}</For>
  </div>
  <Show when={props.fields.side === "new"}><button type="button" data-button="quiet" aria-pressed={props.fields.replacement !== null ? "true" : "false"} onClick={() => props.edit({ replacement: props.fields.replacement === null ? sourceOf(props.comparison, props.fields) : null })}>{copy.suggestChange}</button></Show>
</>;

export const ReplacementField = (props: { value: string | null; edit: (value: string) => void }) => <Show when={props.value !== null}><label class="note-field">{copy.replacement}<textarea class="note-input field-inline" rows={Math.min(12, Math.max(2, (props.value ?? "").split("\n").length))} spellcheck="false" autocorrect="off" autocapitalize="off" value={props.value ?? ""} maxlength={20000} onInput={event => props.edit(event.currentTarget.value)} /></label></Show>;
