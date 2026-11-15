import { captureFocus } from "../keys/focus";
import { questionAsked } from "../keys/registry";
import { createEffect, createSignal, Show, on, onCleanup, untrack } from "solid-js";
import { answerOf, type App, type NativeAnswer, type NativeQuestion, type RemovalQuestion, type RemovalAnswer } from "../app/seam";
import { copy } from "./copy";
import { ReservedLine } from "../ink/ReservedLine";
import { isSuppressed, suppressQuestion } from "../settings/warnings";
import type { QuestionKey } from "../settings/preferences";

const askNative = (app: Pick<App, "ask"> & Partial<Pick<App, "askRemoval">>, question: NativeQuestion | RemovalQuestion): Promise<NativeAnswer | RemovalAnswer> => {
  if (!("thisLabel" in question)) return app.ask(question);

  if (!app.askRemoval) throw new Error(copy.nativeRemovalAlertUnavailable);

  return app.askRemoval(question);
};

type Read = { accepted: boolean; suppressed: boolean; each?: "this" | "all" };

/** Asks the native question; a suppressed key answers yes without showing, and a keyed question offers "Don't ask again". */
const ask = async (app: Pick<App, "ask"> & Partial<Pick<App, "askRemoval">>, question: NativeQuestion | RemovalQuestion, key?: QuestionKey): Promise<Read> => {
  if (key !== undefined && isSuppressed(key)) return { accepted: true, suppressed: false };

  return read(await askNative(app, key === undefined ? question : { ...question, suppressible: copy.dontAskAgain }));
};

const read = (raw: NativeAnswer | RemovalAnswer): Read => {
  if (raw === "this" || raw === "all") return { accepted: true, suppressed: false, each: raw };

  return raw === "cancel" ? { accepted: false, suppressed: false } : answerOf(raw);
};

/** A native question owns one request until answered. A request the system cannot show authorizes nothing and is never replayed (U6249d C10): its cause goes to the log and the same question is asked in the App, where the user answers it. */
export const NativeAlert = (props: {
  app: Pick<App, "ask"> & Partial<Pick<App, "askRemoval">>;
  open: boolean;
  question: NativeQuestion | RemovalQuestion;
  /** U7157: the question's own key; a suppressed one confirms without showing. A removal question has two confirms, so it carries none. */
  key?: QuestionKey;
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
      const key = "thisLabel" in question ? undefined : props.key;
      const { accepted, suppressed, each } = await ask(props.app, question, key);

      if (mine !== generation || !props.open) return;

      // A changed ownership/consequence warning needs its own affirmative answer.
      const latest = props.question;

      if (accepted && (JSON.stringify(question) !== JSON.stringify(latest))) {
        repeat = true;

        return;
      }

      if (accepted && key !== undefined && suppressed) await suppressQuestion(key);

      if (accepted) await props.onConfirm(each);
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
