import { createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { Actor } from "@contracts/Actor";
import { BusyButton } from "../ui/BusyButton";
import { StatusNote } from "../ink/MountedLine";
import { useConnectedProject } from "../state/connectedProject";
import { copy } from "./copy";
import { lastWriter, padNotesOf } from "./padNotes";
import type { PadNote } from "./padNotes";

/** U7705: select text, add a note, send it back quoting the selection. Nothing here writes the Pad. */
export const PadNotes = (props: { name: string; revision: () => number; selection: () => string }) => {
  const connected = useConnectedProject();
  const store = padNotesOf(connected);
  const name = untrack(() => props.name);
  const [draft, setDraft] = createSignal<{ quote: string; revision: number; text: string } | null>(null);
  const [writer, setWriter] = createSignal<Actor | null>(null);
  const [picking, setPicking] = createSignal<number | null>(null);

  const agents = () => connected.rail.nodes.filter(node => node.kind === "agent");

  const receiver = () => {
    const actor = writer();

    return actor?.kind === "agent" ? agents().find(node => node.id === actor.id) : undefined;
  };

  // The receiver is the Pad's last writer; a rewrite by another Actor moves it.
  const loadWriter = () => connected.app.rpc("provenance.history", { item: `pad:${name}` }).then(history => setWriter(lastWriter(history)), () => setWriter(null));

  void loadWriter();
  onCleanup(connected.events.subscribe(event => { if (event.name === "pad.changed" && event.data.name === name) void loadWriter(); }));

  const failure = (note: PadNote) => {
    const state = store.send(name, note.id);

    return state.kind === "failed" ? state.text : null;
  };

  const save = () => {
    const value = draft();

    if (!value || value.text.trim() === "") return;
    store.save(name, value.revision, value.quote, value.text);
    setDraft(null);
  };

  const deliver = (note: PadNote, to: string) => {
    setPicking(null);

    return store.deliver(connected.app, name, note, to);
  };

  return <section class="pad-notes" aria-label={copy.padNotes}>
    <Show when={!draft() && props.selection() !== ""}>
      <button type="button" data-button="quiet" onClick={() => setDraft({ quote: props.selection(), revision: props.revision(), text: "" })}>{copy.addNote}</button>
    </Show>
    <Show when={draft()}>{value => <form class="pad-note-form" aria-label={copy.padNote} onSubmit={event => { event.preventDefault(); save(); }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setDraft(null); } }}>
      <blockquote class="pad-note-quote" aria-label={copy.padNoteQuote} tabindex="0">{value().quote}</blockquote>
      <label class="note-field">{copy.padNoteText}<textarea class="field-frame" spellcheck="false" value={value().text} ref={element => queueMicrotask(() => element.focus())} onInput={event => setDraft({ ...value(), text: event.currentTarget.value })} /></label>
      <div class="diff-actions">
        <button type="button" data-button="quiet" onClick={() => setDraft(null)}>{copy.cancelNote}</button>
        <button type="submit" data-button="primary" disabled={value().text.trim() === ""}>{copy.saveNote}</button>
      </div>
    </form>}</Show>
    <Show when={store.list(name).length}>
      <ul class="pad-note-list"><For each={store.list(name)}>{note => <li>
        <blockquote class="pad-note-quote" tabindex="0">{note.quote}</blockquote>
        <p class="note-text">{note.text}</p>
        <StatusNote text={failure(note)} />
        <div class="diff-actions">
          <button type="button" data-button="quiet" aria-label={copy.removeNote} onClick={() => store.remove(name, note.id)}>{copy.removeNote}</button>
          <Show when={receiver()} fallback={<button type="button" data-button="quiet" aria-expanded={picking() === note.id ? "true" : "false"} onClick={() => { setPicking(picking() === note.id ? null : note.id); }}>{copy.sendNoteTo("…")}</button>}>{node =>
            <BusyButton kind="quiet" busy={store.send(name, note.id).kind === "pending"} busyLabel={copy.sendingNote} onClick={() => deliver(note, node().id)}>{(store.send(name, note.id).kind === "failed" ? copy.retrySendNoteTo : copy.sendNoteTo)(node().name)}</BusyButton>}
          </Show>
        </div>
        <Show when={picking() === note.id}><div role="group" aria-label={copy.pickReceiver} class="diff-actions"><For each={agents()}>{node => <button type="button" data-button="quiet" onClick={() => void deliver(note, node.id)}>{node.name}</button>}</For></div></Show>
      </li>}</For></ul>
    </Show>
  </section>;
};
