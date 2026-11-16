import { createSignal, onCleanup, untrack, For } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import type { CapturePort, CaptureState } from "../app/seam";
import { dismissable, ReservedLine } from "../ink/ReservedLine";
import { copy } from "./copy";
import { BusyButton } from "../ui/BusyButton";
import "./capture.styles.css";

/** Presentation only. Edits and deliberate actions return to the original Capture owner. */
export const CapturePanel = (props: { port: CapturePort }) => {
  const [state, setState] = createSignal<CaptureState>();
  const published = dismissable(() => state()?.failure);
  const [text, setText] = createSignal("");
  const [failure, setFailure] = createSignal<string | null>(null);
  let sequence = 0;
  let input: HTMLTextAreaElement | undefined;

  const send: CapturePort["act"] = async action => {
    try { await props.port.act(action); setFailure(null); }
    catch (error) { setFailure(String(error)); }
  };

  onCleanup(untrack(() => props.port.onState(snapshot => {
    if (snapshot.session !== state()?.session) sequence = 0;

    if (snapshot.sequence >= sequence) setText(snapshot.text);
    setState(snapshot);
    document.documentElement.dataset.mode = snapshot.mode;
    document.documentElement.style.colorScheme = snapshot.mode;
    input?.focus({ preventScroll: true });
  }, () => untrack(() => void send({ kind: "ready" })))));

  const file = (keepOpen: boolean) => {
    const current = state();

    return current ? send({ kind: "file", session: current.session, sequence: ++sequence, text: text(), keepOpen }) : undefined;
  };

  const dismiss = () => {
    const current = state();

    return current ? send({ kind: "dismiss", session: current.session }) : undefined;
  };

  makeEventListener(window, "blur", dismiss);

  return <section class="capture capture-native" aria-label={copy.captureLabel} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); void dismiss(); }
  }}>
    <textarea spellcheck="false" autocorrect="off" autocapitalize="off" ref={input} class="capture-field field-frame" rows={1} aria-label={copy.captureLabel} placeholder={copy.capturePlaceholder} value={text()}
      onInput={event => {
        setText(event.currentTarget.value);
        const current = state();

        if (current) void send({ kind: "edit", session: current.session, sequence: ++sequence, text: text() });
      }} onKeyDown={event => {
        if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void file(event.shiftKey); }
      }} />
    <p class="capture-target"><span>{state()?.owner}</span><span>{state()?.home}</span></p>
    <ReservedLine message={failure() ?? published.message()} dismiss={() => failure() ? setFailure(null) : published.dismiss()} recover={state()?.retention ? { run: () => {
      const current = state();

      return current ? send({ kind: "retry", session: current.session }) : undefined;
    } } : undefined} />
    <For each={state()?.recovered}>{draft => <div class="capture-recovery">
      <span class="ink" data-state={draft.status}>{draft.label}</span>
      <textarea class="capture-field field-frame" aria-label={copy.recoveredCaptureDraft} rows={1} readonly value={draft.text} />
      <div class="capture-actions">
        <BusyButton kind="quiet" busyLabel={copy.copying} onClick={() => {
          const current = state();

          return current ? send({ kind: "copy", session: current.session, revision: draft.revision }) : undefined; }}>{copy.copy}</BusyButton>
        <BusyButton kind="quiet" busyLabel={copy.discarding} onClick={() => {
          const current = state();

          return current ? send({ kind: "discard-revision", session: current.session, revision: draft.revision }) : undefined; }}>{copy.discardRevision}</BusyButton>
      </div>
    </div>}</For>
    <div class="capture-actions"><BusyButton kind="quiet" busyLabel={copy.closing} onClick={dismiss}>{copy.close}</BusyButton><BusyButton kind="primary" disabled={!state() || text().trim() === ""} busyLabel={copy.capturing} onClick={() => file(false)}>{copy.captureATodo}</BusyButton></div>
  </section>;
};
