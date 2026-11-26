import { createSignal, Show } from "solid-js";
import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { copy } from "./copy";
import { filesOf, isItem } from "./notes";
import type { LineNote, Note, Notes } from "./notes";

/** U7677b: a note over this many lines folds behind Show all. */
const FOLD = 6;

/** What a saved note says of itself beside its range. */
export type NoteStatus = "unsent" | "sending" | "unknown" | "failed" | "waiting" | "sent" | "outdated";

/** U7956a: an accepted note reads Waiting until its Message lands; a note kept before the Message was recorded reads Sent. */
export const acceptedAs = (note: Pick<Note, "message" | "landed">): "waiting" | "sent" => note.message !== undefined && note.landed === undefined ? "waiting" : "sent";

/** A note's state: its store state while unsent, else Waiting or Sent, or Outdated once its target moved (U7677e, U7691c, U7956a). */
export const statusOf = (notes: Notes, id: string, note: Note, outdated: () => boolean): NoteStatus => note.sent === undefined ? notes.noteState(id, note) : outdated() ? "outdated" : acceptedAs(note);

const statusWords: Partial<Record<NoteStatus, string>> = {
  waiting: copy.waiting,
  outdated: copy.outdated,
  sending: copy.sending,
  unknown: copy.sendUnknown,
  failed: copy.couldntSend,
};

export const words = (status: NoteStatus, note: Pick<Note, "sent" | "landed">) => status === "sent" ? copy.sentAt(note.landed ?? note.sent) : statusWords[status] ?? copy.notSent;

export const range = (note: LineNote) => note.start === note.end ? (note.side === "old" ? copy.oldLine(note.start) : copy.newLine(note.start)) : note.side === "old" ? copy.oldLines(note.start, note.end) : copy.newLines(note.start, note.end);

/** What a note's meta line names first: its lines, or for an item note its kind and file count (U7691b). */
export const where = (note: Note) => isItem(note) ? copy.itemMeta(note.item.kind, filesOf(note.item).length) : range(note);

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
  return <article class="note-view" data-surface="diff" data-state={props.status} data-focused={focused() || undefined} tabindex="0" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusIn={() => setFocused(true)} onFocusOut={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
    <p class="note-body" onClick={() => { if (editable()) props.edit(); }}>{(folded() ? lines().slice(0, limit()) : lines()).join("\n")}</p>
    <Show when={!isItem(props.note) && props.note.replacement !== undefined && !folded()}><pre class="note-replacement">{!isItem(props.note) ? props.note.replacement : undefined}</pre></Show>
    <p class="note-meta">{where(props.note)}{props.note.label === undefined ? "" : copy.dottedAfter(copy.labels[props.note.label])}{copy.dottedAfter(words(props.status, props.note))}<Show when={folded()}>{copy.dottedAfter("")}<IconButton aria-label={copy.showAll} onClick={() => setOpen(true)}><Icon name="down" /></IconButton></Show></p>
    <Show when={hovered() || focused()}><div class="note-actions">
      <Show when={editable()}><IconButton aria-label={copy.editTip} onClick={props.edit}><Icon name="edit" /></IconButton></Show>
      <Show when={removable()}><IconButton aria-label={copy.removeTip} onClick={props.remove}><Icon name="trash" /></IconButton></Show>
    </div></Show>
  </article>;
};
