import { createEffect, createSignal, Show, on, onCleanup, untrack } from "solid-js";
import type { App, NativeQuestion } from "../app/seam";
import { copy } from "../copy";
import { ReservedLine } from "../ink/ReservedLine";

/** A native question owns one request until answered; failed requests authorize nothing and can be retried. */
export const NativeAlert = (props: {
  app: Pick<App, "ask">;
  open: boolean;
  question: NativeQuestion;
  onConfirm: () => void;
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
    setFailure(null);

    try {
      const accepted = await props.app.ask({ ...props.question });

      if (mine !== generation || !props.open) return;

      if (accepted) props.onConfirm();
      else props.onCancel();
      queueMicrotask(() => props.finalFocus()?.focus({ preventScroll: true }));
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      if (mine === generation && props.open) {
        setFailure(error.message);
        queueMicrotask(() => line?.querySelector("button")?.focus());
      }
    } finally {
      pending = false;
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
