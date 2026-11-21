import { createSignal, Show } from "solid-js";
import { clockTime } from "../drawer/copy";
import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { copy } from "./copy";
import type { Note } from "./notes";

/** U7677b: a note over this many lines folds behind Show all. */
const FOLD = 6;

/** What a saved note says of itself beside its range. */
export type NoteStatus = "unsent" | "sending" | "unknown" | "failed" | "sent" | "outdated";

const words = (status: NoteStatus, note: Note) => status === "sent" ? copy.sentAt(clockTime.format(note.sent)) : status === "outdated" ? copy.outdated : status === "sending" ? copy.sending : status === "unknown" ? copy.sendUnknown : status === "failed" ? copy.couldntSend : copy.notSent;

const range = (note: Note) => note.start === note.end ? (note.side === "old" ? copy.oldLine(note.start) : copy.newLine(note.start)) : note.side === "old" ? copy.oldLines(note.start, note.end) : copy.newLines(note.start, note.end);

/** U7677b, U7677c: a saved note: its body, one meta line, and Edit and Remove only on hover or focus. */
export const NoteView = (props: { note: Note; status: NoteStatus; edit: () => void; remove: () => void }) => {
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const [open, setOpen] = createSignal(false);
  const lines = () => props.note.text.split("\n");
  const limit = () => props.status === "outdated" ? 1 : FOLD;
  const folded = () => !open() && lines().length > limit();
  const editable = () => props.status === "unsent" || props.status === "failed";
  const removable = () => props.status !== "sending" && props.status !== "unknown";

  // SAFETY: relatedTarget is null or the Node focus moved to.
  return <article class="note-view" data-surface="diff" data-state={props.status} tabindex="0" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusIn={() => setFocused(true)} onFocusOut={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
    <p class="note-body" onClick={() => { if (editable()) props.edit(); }}>{(folded() ? lines().slice(0, limit()) : lines()).join("\n")}</p>
    <p class="note-meta">{range(props.note)}{copy.dottedAfter(words(props.status, props.note))}<Show when={folded()}>{copy.dottedAfter("")}<button type="button" data-button="quiet" onClick={() => setOpen(true)}>{copy.showAll}</button></Show></p>
    <Show when={hovered() || focused()}><div class="note-actions">
      <Show when={editable()}><IconButton aria-label={copy.editTip} onClick={props.edit}><Icon name="edit" /></IconButton></Show>
      <Show when={removable()}><IconButton aria-label={copy.removeTip} onClick={props.remove}><Icon name="trash" /></IconButton></Show>
    </div></Show>
  </article>;
};
