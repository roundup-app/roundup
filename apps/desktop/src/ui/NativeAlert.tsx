import { captureFocus } from "../keys/focus";
import { questionAsked } from "../keys/registry";
import { createEffect, createSignal, Show, on, onCleanup, untrack } from "solid-js";
import type { App, NativeQuestion, RemovalQuestion, RemovalAnswer } from "../app/seam";
import { copy } from "./copy";
import { ReservedLine } from "../ink/ReservedLine";

const askNative = (app: Pick<App, "ask"> & Partial<Pick<App, "askRemoval">>, question: NativeQuestion | RemovalQuestion) => {
  if (!("thisLabel" in question)) return app.ask(question);

  if (!app.askRemoval) throw new Error(copy.nativeRemovalAlertUnavailable);

  return app.askRemoval(question);
};

/** A native question owns one request until answered. A request the system cannot show authorizes nothing and is never replayed (U6249d C10): its cause goes to the log and the same question is asked in the App, where the user answers it. */
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
    const answered = questionAsked();
    setFailure(null);

    try {
      const question = { ...props.question };
      const answer = await askNative(props.app, question);
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
      queueMicrotask(() => focus(() => untrack(() => props.finalFocus())?.focus({ preventScroll: true })));
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      if (mine === generation && props.open) {
        console.error(error.message);
        setFailure(error.message);
        queueMicrotask(() => focus(() => line?.querySelector("button")?.focus()));
      }
    } finally {
      answered();
      pending = false;

      // An answer that opened the next question (a queued close) asks it now that this request is done.
      if (repeat || (mine !== generation && untrack(() => props.open))) void request();
    }
  };

  createEffect(on(() => props.open, open => {
    generation++;
    setFailure(null);

    if (open) untrack(() => void request());
  }));

  const answer = (value?: RemovalAnswer) => {
    setFailure(null);
    void props.onConfirm(value);
  };

  const cancel = () => {
    setFailure(null);
    props.onCancel();
    props.finalFocus()?.focus();
  };

  const removal = () => "thisLabel" in props.question ? props.question : null;
  const confirm = () => "okLabel" in props.question ? props.question.okLabel : "";

  return <Show when={failure()}><ReservedLine class="native-alert-failure" ref={element => { line = element; }} status={props.question.message}>
    <Show when={removal()} fallback={<button data-button="quiet" type="button" onClick={() => answer()}>{confirm()}</button>}>
      {each => <><button data-button="quiet" type="button" onClick={() => answer("this")}>{each().thisLabel}</button><button data-button="quiet" type="button" onClick={() => answer("all")}>{each().allLabel}</button></>}
    </Show>
    <button data-button="quiet" type="button" onClick={cancel}>{props.question.cancelLabel}</button>
  </ReservedLine></Show>;
};
