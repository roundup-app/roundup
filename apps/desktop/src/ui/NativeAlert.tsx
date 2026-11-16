import { captureFocus } from "../keys/focus";
import { questionAsked } from "../keys/registry";
import { createEffect, createMemo, createSignal, Show, onCleanup, untrack } from "solid-js";
import { answerOf, type App, type NativeAnswer, type NativeQuestion, type RemovalQuestion, type RemovalAnswer } from "../app/seam";
import { copy } from "./copy";
import { BusyButton } from "./BusyButton";
import { ReservedLine } from "../ink/ReservedLine";
import { Checkbox } from "./Checkbox";
import { isSuppressed, suppressQuestion } from "../settings/warnings";
import type { QuestionKey } from "../settings/preferences";

const askNative = (app: Pick<App, "ask"> & Partial<Pick<App, "askRemoval">>, question: NativeQuestion | RemovalQuestion): Promise<NativeAnswer | RemovalAnswer> => {
  if (!("thisLabel" in question)) return app.ask(question);

  if (!app.askRemoval) throw new Error(copy.nativeRemovalAlertUnavailable);

  return app.askRemoval(question);
};

type Read = { accepted: boolean; suppress?: QuestionKey; each?: "this" | "all" };

/** Asks the native question; a suppressed key answers yes without showing, and a keyed question offers "Don't ask again". It returns the pending answer itself, so the caller settles in the same ticks as a bare ask. */
const ask = (app: Pick<App, "ask"> & Partial<Pick<App, "askRemoval">>, question: NativeQuestion | RemovalQuestion, key?: QuestionKey): Promise<NativeAnswer | RemovalAnswer> | true => {
  if (key === undefined) return askNative(app, question);

  return isSuppressed(key) ? true : askNative(app, { ...question, suppressible: copy.dontAskAgain });
};

const read = (raw: NativeAnswer | RemovalAnswer, key?: QuestionKey): Read => {
  if (raw === "this" || raw === "all") return { accepted: true, each: raw };

  if (raw === "cancel") return { accepted: false };

  const { accepted, suppressed } = answerOf(raw);

  return key !== undefined && suppressed ? { accepted, suppress: key } : { accepted };
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
  const [ticked, setTicked] = createSignal(false);
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
    setTicked(false);

    try {
      const question = { ...props.question };
      const key = "thisLabel" in question ? undefined : props.key;
      const { accepted, suppress, each } = read(await ask(props.app, question, key), key);

      if (mine !== generation || !props.open) return;

      // A changed ownership/consequence warning needs its own affirmative answer.
      const latest = props.question;

      if (accepted && (JSON.stringify(question) !== JSON.stringify(latest))) {
        repeat = true;

        return;
      }

      if (accepted && suppress) await suppressQuestion(suppress);

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

  // A memo: the same open question must not bump the generation and ask the native dialog again.
  const asked = createMemo(() => props.open);

  createEffect(asked, open => {
    generation++;
    setFailure(null);

    if (open) untrack(() => void request());
  });

  const answer = async (value?: RemovalAnswer) => {
    const suppress = ticked() && !removal() ? props.key : undefined;
    setFailure(null);

    if (suppress !== undefined) await suppressQuestion(suppress);

    return props.onConfirm(value);
  };

  const cancel = () => {
    setFailure(null);
    props.onCancel();
    props.finalFocus()?.focus();
  };

  const removal = () => "thisLabel" in props.question ? props.question : null;
  const confirm = () => "okLabel" in props.question ? props.question.okLabel : "";

  return <Show when={failure()}><ReservedLine class="native-alert-failure" ref={element => { line = element; }} status={props.question.message}>
    <Show when={removal()} fallback={<>
      <Show when={props.key}><Checkbox checked={ticked()} onCheckedChange={setTicked}>{copy.dontAskAgain}</Checkbox></Show>
      <BusyButton kind="quiet" busyLabel={copy.confirming} onClick={() => answer()}>{confirm()}</BusyButton>
    </>}>
      {each => <><BusyButton kind="quiet" busyLabel={copy.removing} onClick={() => answer("this")}>{each().thisLabel}</BusyButton><BusyButton kind="quiet" busyLabel={copy.removing} onClick={() => answer("all")}>{each().allLabel}</BusyButton></>}
    </Show>
    <button data-button="quiet" type="button" onClick={cancel}>{props.question.cancelLabel}</button>
  </ReservedLine></Show>;
};
