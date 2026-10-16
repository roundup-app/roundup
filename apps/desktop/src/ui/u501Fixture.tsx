import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Listbox } from "./index";
import { Markdown } from "../plain/Markdown";
import { copy } from "../copy";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";
import "../decisions/styles.css";

export const u501Fixture = () => {
  const answers = [
    { value: "brief", label: "A · Brief", description: "Keep the summary short", preview: "**Brief**\n\nKeep `these bytes`." },
    { value: "detail", label: "B · Detailed explanation with a long supplied answer name", description: "Include the reasoning and the tradeoffs\nwithout losing the supplied text", preview: "## Details\n\n- First\n- Second" },
    { value: "full", label: "C · Full", description: "Include every result", preview: "**Full**\n\nAll results." },
  ];

  const [value, setValue] = createSignal<string | null>(answers[0]!.value);
  const [note, setNote] = createSignal("unchanged draft");
  const [pending, setPending] = createSignal(false);
  const [requests, setRequests] = createSignal(0);
  const [mounted, setMounted] = createSignal(true);
  const focused = () => answers.find(item => item.value === value());
  let root!: HTMLDivElement;
  let commit = 0;
  const frames = new Set<number>();

  const acknowledge = () => {
    const frame = requestAnimationFrame(() => { frames.delete(frame); root.dataset.commit = String(++commit); });
    frames.add(frame);
  };

  onMount(() => {
    for (const event of ["click", "keydown", "input", "pointermove", "pointerover"]) document.addEventListener(event, acknowledge);
    acknowledge();
  });
  onCleanup(() => {
    for (const event of ["click", "keydown", "input", "pointermove", "pointerover"]) document.removeEventListener(event, acknowledge);

    for (const frame of frames) cancelAnimationFrame(frame);
  });
  const send = () => { if (!pending() && (value() !== null || note().trim())) setRequests(requests() + 1); };

  return <div ref={root} data-fixture="listbox">
    <button type="button" data-button="quiet">Before</button>
    <div class="decision-card">
      <Show when={mounted()}>
        <Listbox.Root answers={answers} value={value()} highlightedValue={value()} onValueChange={setValue} onHighlightChange={setValue} pending={pending()}>
          <Listbox.Label>{copy.answers}</Listbox.Label>
          <Listbox.Content><For each={answers}>{item => <Listbox.Item item={item} />}</For></Listbox.Content>
          <Show when={focused()}>{item => <div class="ask-preview"><Markdown body={item().preview} /></div>}</Show>
          <div class="ask-note">
            <Listbox.NoteInput aria-label={copy.note} value={note()} placeholder={focused() ? copy.noteForOrYourOwnAnswer(focused()!.label) : copy.yourOwnAnswer}
              onInput={event => setNote(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") send(); }} />
            <button type="button" data-button="quiet" onClick={send} aria-disabled={pending() || (value() === null && !note().trim()) || undefined}>{copy.send}</button>
          </div>
        </Listbox.Root>
      </Show>
    </div>
    <button type="button" data-button="quiet" onClick={() => setPending(!pending())}>Toggle pending</button>
    <button type="button" data-button="quiet" onClick={() => setValue("full")}>External Full</button>
    <button type="button" data-button="quiet" onClick={() => setMounted(false)}>Dispose</button>
    <output aria-label="Requests">{requests()}</output>
  </div>;
};
