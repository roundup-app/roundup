import { captureFocus } from "../keys/focus";
import { createEffect, createSignal, Show, on, onCleanup, untrack } from "solid-js";
import type { App, NativeQuestion, RemovalQuestion, RemovalAnswer } from "../app/seam";
import { copy } from "./copy";
import { ReservedLine } from "../ink/ReservedLine";

/** A native question owns one request until answered; failed requests authorize nothing and can be retried. */
export const NativeAlert = (props: {
  app: Pick<App, "ask"> & Partial<Pick<App, "askRemoval">>;
  open: boolean;
  question: NativeQuestion | RemovalQuestion;
  onConfirm: (answer?: RemovalAnswer) => void | Promise<void>;
  onCancel: () => void;
  finalFocus: () => HTMLElement | null;
}) => {
  const [failure, setFailure] = createSignal<string | null>(null);
  let pending = false;
  let line: HTMLDivElement | undefined;
  let generation = 0;
  onCleanup(() => { generation++; });

  const request = async () => {
    if (pending || !props.open) return;
    pending = true;
    const mine = generation;
    const focus = captureFocus();
    let repeat = false;
    setFailure(null);

    try {
      const question = { ...props.question };
      let answer: boolean | RemovalAnswer;

      if ("thisLabel" in question) {
        const askRemoval = props.app.askRemoval;

        if (!askRemoval) throw new Error(copy.nativeRemovalAlertUnavailable);
        answer = await askRemoval(question);
      } else answer = await props.app.ask(question);
      const accepted = answer !== false && answer !== "cancel";

      if (mine !== generation || !props.open) return;

      // A changed ownership/consequence warning needs its own affirmative answer.
      const latest = props.question;

      if (accepted && (JSON.stringify(question) !== JSON.stringify(latest))) {
        repeat = true;

        return;
      }

      if (accepted) await props.onConfirm(answer === "this" || answer === "all" ? answer : undefined);
      else props.onCancel();
      queueMicrotask(() => focus(() => props.finalFocus()?.focus({ preventScroll: true })));
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      if (mine === generation && props.open) {
        setFailure(error.message);
        queueMicrotask(() => focus(() => line?.querySelector("button")?.focus()));
      }
    } finally {
      pending = false;

      if (repeat) void request();
    }
  };

  createEffect(on(() => props.open, open => {
    generation++;
    setFailure(null);

    if (open) untrack(() => void request());
  }));

  return <Show when={failure()}><ReservedLine class="native-alert-failure" ref={element => { line = element; }} message={failure()}><>
    <button data-button="quiet" type="button" onClick={() => void request()}>{copy.retry}</button>
    <button data-button="quiet" type="button" onClick={() => { props.onCancel(); props.finalFocus()?.focus(); }}>{copy.cancel}</button>
  </></ReservedLine></Show>;
};
