import { createSignal, onCleanup, Show } from "solid-js";
import type { CapturePort, CaptureState } from "../app/seam";
import { copy } from "../copy";
import { ReservedLine } from "../ink/ReservedLine";
import "./capture.styles.css";

/** Presentation only. Edits and deliberate actions return to the original Capture owner. */
export const CapturePanel = (props: { port: CapturePort }) => {
  const [state, setState] = createSignal<CaptureState>();
  const [text, setText] = createSignal("");
  const [failure, setFailure] = createSignal<string | null>(null);
  let sequence = 0;
  let input: HTMLTextAreaElement | undefined;
  let stopped = false;
  let release: (() => void) | undefined;
  const send: CapturePort["act"] = async action => {
    try { await props.port.act(action); setFailure(null); }
    catch (error) { setFailure(String(error)); }
  };
  void props.port.onState(snapshot => {
    if (snapshot.session !== state()?.session) sequence = 0;
    if (snapshot.sequence >= sequence) setText(snapshot.text);
    setState(snapshot);
    document.documentElement.dataset.mode = snapshot.mode;
    document.documentElement.style.colorScheme = snapshot.mode;
    input?.focus({ preventScroll: true });
  }).then(stop => {
    if (stopped) { stop(); return; }
    release = stop;
    void send({ kind: "ready" });
  }).catch(error => setFailure(String(error)));
  onCleanup(() => { stopped = true; release?.(); });

  const file = (keepOpen: boolean) => {
    const current = state();
    if (current) void send({ kind: "file", session: current.session, sequence: ++sequence, text: text(), keepOpen });
  };
  const dismiss = () => {
    const current = state();
    if (current) void send({ kind: "dismiss", session: current.session });
  };
  window.addEventListener("blur", dismiss);
  onCleanup(() => window.removeEventListener("blur", dismiss));
  return <section class="capture capture-native" aria-label={copy.captureLabel} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); dismiss(); }
  }}>
    <textarea ref={input} class="capture-field" rows={1} aria-label={copy.captureLabel} placeholder={copy.capturePlaceholder} value={text()}
      onInput={event => {
        setText(event.currentTarget.value);
        const current = state();
        if (current) void send({ kind: "edit", session: current.session, sequence: ++sequence, text: text() });
      }} onKeyDown={event => {
        if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); file(event.shiftKey); }
      }} />
    <p class="capture-target"><span>{state()?.owner}</span><span>{state()?.home}</span></p>
    <ReservedLine message={failure() ?? state()?.failure ?? null}>
      <Show when={state()?.failure}><button data-button="quiet" onClick={() => { const current = state(); if (current) void send({ kind: "retry", session: current.session }); }}>{copy.retry}</button></Show>
    </ReservedLine>
    <div class="capture-actions"><button data-button="quiet" onClick={dismiss}>{copy.cancel}</button><button data-button="primary" disabled={!state() || text().trim() === ""} onClick={() => file(false)}>{copy.captureATodo}</button></div>
  </section>;
};
