import { createEffect, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { Actor } from "@contracts/Actor";
import { BusyButton } from "../ui/BusyButton";
import { Combobox } from "../ui/Combobox";
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

  let section: HTMLElement | undefined;

  const agents = () => connected.rail.nodes.filter(node => node.kind === "agent");

  const receiver = () => {
    const actor = writer();

    return actor?.kind === "agent" ? agents().find(node => node.id === actor.id) : undefined;
  };

  // The receiver is the Pad's last writer; a rewrite by another Actor moves it.
  const loadWriter = () => connected.app.rpc("provenance.history", { item: `pad:${name}` }).then(history => setWriter(lastWriter(history)), () => setWriter(null));

  // Only a Pad with notes needs its receiver: opening a Pad reads nothing more.
  const hasNotes = () => store.list(name).length > 0;

  createEffect(hasNotes, has => { if (has) void loadWriter(); });
  onCleanup(connected.events.subscribe(event => { if (event.name === "pad.changed" && event.data.name === name && hasNotes()) void loadWriter(); }));

  const failure = (note: PadNote) => {
    const state = store.send(name, note.id);

    return state.kind === "failed" ? state.text : null;
  };

  const save = () => {
    const value = draft();

    if (!value || value.text.trim() === "") return;
    store.save(name, value.revision, value.quote, value.text);
    setDraft(null);
    queueMicrotask(() => section?.querySelector<HTMLElement>(".pad-note:last-child .diff-actions button:last-child")?.focus());
  };

  const deliver = (note: PadNote, to: string) => {
    return store.deliver(connected.app, name, note, to);
  };

  return <section ref={section} class="pad-notes" aria-label={copy.padNotes}>
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
      <div class="pad-note-list" role="list"><For each={store.list(name)}>{note => <div role="listitem" class="pad-note">
        <blockquote class="pad-note-quote" tabindex="0">{note.quote}</blockquote>
        <p class="note-text">{note.text}</p>
        <StatusNote text={failure(note)} />
        <div class="diff-actions">
          <button type="button" data-button="quiet" aria-label={copy.removeNote} onClick={() => store.remove(name, note.id)}>{copy.removeNote}</button>
          <Show when={receiver()} fallback={<Combobox.Picker label={copy.pickReceiver} value="" savedLabel={copy.sendNote} items={agents().map(node => ({ value: node.id, label: node.name }))} onSelect={to => { void deliver(note, to); }} />}>{node =>
            <BusyButton kind="quiet" busy={store.send(name, note.id).kind === "pending"} busyLabel={copy.sendingNote} onClick={() => deliver(note, node().id)}>{(store.send(name, note.id).kind === "failed" ? copy.retrySendNoteTo : copy.sendNoteTo)(node().name)}</BusyButton>}
          </Show>
        </div>
      </div>}</For></div>
    </Show>
  </section>;
};
