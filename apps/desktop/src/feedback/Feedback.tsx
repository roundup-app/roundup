import { createSignal, onCleanup, Show, untrack } from "solid-js";
import type { Check } from "@contracts/feedback/Check";
import type { Filed } from "@contracts/feedback/Filed";
import type { FeedbackReport } from "../app/seam";
import { queueFocus } from "../keys/focus";
import { CHORDS } from "../keys/chords";
import { modalOpen, registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import type { ToastQueue } from "../toasts/queue";
import { Checkbox } from "../ui/Checkbox";
import { CopyButton } from "../ui/CopyButton";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { copy } from "./copy";
import { versionsText } from "./facts";
import "./styles.css";

/** What the shot left: the window as drawn, or why there is none. */
type Opened = { capture: FeedbackReport | null; cause: string | null };

/** U7210a to U7210e: a request takes the shot, then opens the dialog; Send files one Issue and closes it, a failure keeps it open with the text. */
export const Feedback = (props: { notify: ToastQueue["notify"] }) => {
  const { app, project } = useConnectedProject();
  const [opened, setOpened] = createSignal<Opened | null>(null);
  const [capturing, setCapturing] = createSignal(false);
  const [check, setCheck] = createSignal<Check | null>(null);
  const [checkFailure, setCheckFailure] = createSignal<string | null>(null);
  const [text, setText] = createSignal("");
  const [attach, setAttach] = createSignal(true);
  const [sending, setSending] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  let form: HTMLFormElement | undefined;

  const versions = () =>
    versionsText(opened()?.capture?.facts ?? null, check()?.herdrCore);

  /** The line saying why Send is not offered, once `gh` is known. */
  const blocked = () =>
    checkFailure() ??
    (check()?.gh === "missing"
      ? copy.noGh
      : check()?.gh === "signed-out"
        ? copy.signedOut
        : null);

  const shot = () => opened()?.capture?.shot ?? null;

  const attached = () => shot() !== null && check()?.attach === true;

  const noShotLine = () => {
    if (shot() === null)
      return opened()?.cause ? copy.noShot(opened()!.cause!) : null;

    return check() !== null && !check()!.attach && blocked() === null
      ? copy.oldGh
      : null;
  };

  const notify = (candidate: {
    name: string;
    line: string;
    kind: "done" | "error";
    open: () => Promise<string | null> | string | null;
  }) => {
    const key = `feedback:${crypto.randomUUID()}`;

    props.notify({
      key,
      item: key,
      project: project.path,
      selected: false,
      ...candidate,
    });
  };

  const filed = (issue: Filed) =>
    notify({
      kind: "done",
      name: copy.filed(issue.number),
      line: copy.openIssue,
      open: async () => {
        try {
          await app.openTarget({ kind: "url", url: issue.url });

          return null;
        } catch (error) {
          if (!(error instanceof Error)) throw error;

          return error.message;
        }
      },
    });

  const begin = async () => {
    if (opened() !== null || capturing()) return;

    setCapturing(true);
    setCheck(null);
    setCheckFailure(null);
    // `gh` is asked while the window is captured, so the dialog opens knowing what it can send.
    void app
      .rpc("feedback.check", null)
      .then(setCheck, (error: Error) => setCheckFailure(error.message));
    let capture: FeedbackReport | null = null;
    let cause: string | null = null;

    try {
      if (app.feedbackCapture) capture = await app.feedbackCapture();
      else cause = copy.noCapture;
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      cause = error.message;
    }

    setCapturing(false);
    cause ??= capture?.shot_error ?? (capture?.shot ? null : copy.noCapture);
    setText("");
    setAttach(true);
    setSending(false);
    setFailure(null);
    setOpened({ capture, cause });
  };

  registerKeys({ kind: "app" }, [
    {
      action: CHORDS["feedback.open"],
      capture: () => ({
        available: () => opened() === null && !capturing() && !modalOpen(),
        invoke: () => void begin(),
      }),
    },
  ]);
  onCleanup(untrack(() => app.onFeedback(begin)));

  const send = async () => {
    const current = opened();

    if (
      !current ||
      sending() ||
      text().trim() === "" ||
      check() === null ||
      blocked() !== null
    )
      return;

    const params: Parameters<typeof app.rpc<"feedback.send">>[1] = {
      text: text(),
      versions: versions(),
    };

    const picture = shot();

    if (picture && attach() && attached()) params.shot = picture;

    setSending(true);
    setFailure(null);

    try {
      const issue = await app.rpc("feedback.send", params);

      // A dialog cancelled meanwhile, or opened again since, is not this one's to close.
      if (opened() === current) setOpened(null);
      filed(issue);
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      if (opened() === current) {
        setFailure(error.message);
        setSending(false);
      } else
        notify({
          kind: "error",
          name: error.message,
          line: copy.notSent,
          open: () => null,
        });
    }
  };

  return (
    <Dialog.Root
      open={opened() !== null}
      initialFocusEl={() => form?.querySelector("textarea") ?? null}
      onOpenChange={({ open }) => {
        if (!open) setOpened(null);
      }}
    >
      <Dialog.Positioner>
        <Dialog.Content class="app-dialog-form feedback-form">
          <form
            ref={(element) => {
              form = element;
              queueFocus(() => {
                if (element.isConnected)
                  element
                    .querySelector("textarea")
                    ?.focus({ preventScroll: true });
              });
            }}
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <Dialog.Title>{copy.title}</Dialog.Title>
            <Field.Root>
              <Field.Label>{copy.line}</Field.Label>
              <Field.Textarea
                rows={4}
                value={text()}
                onInput={(event) => setText(event.currentTarget.value)}
              />
            </Field.Root>
            <Show
              when={attached()}
              fallback={
                <Show when={noShotLine()}>
                  {(line) => <p class="feedback-note">{line()}</p>}
                </Show>
              }
            >
              <Checkbox checked={attach()} onCheckedChange={setAttach}>
                {copy.attach}
              </Checkbox>
            </Show>
            <p class="feedback-versions">{versions()}</p>
            <Show when={blocked()}>
              {(line) => (
                <p class="feedback-note" role="status">
                  {line()}
                </p>
              )}
            </Show>
            <Show when={failure()}>
              {(line) => (
                <p class="feedback-error" role="alert">
                  {line()}
                </p>
              )}
            </Show>
            <div class="app-dialog-actions">
              <Dialog.CloseTrigger type="button" data-button="quiet">
                {copy.close}
              </Dialog.CloseTrigger>
              <Show
                when={blocked() === null}
                fallback={
                  <Show when={check() !== null || checkFailure() !== null}>
                    <CopyButton
                      app={app}
                      text={`${text().trimEnd()}\n\n${versions()}\n`}
                      onFailure={(error) => setFailure(error.message)}
                    >
                      {copy.copy}
                    </CopyButton>
                  </Show>
                }
              >
                <button
                  type="submit"
                  data-button="primary"
                  disabled={
                    text().trim() === "" || check() === null || sending()
                  }
                >
                  {sending()
                    ? copy.sending
                    : check() === null
                      ? copy.checking
                      : copy.send}
                </button>
              </Show>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  );
};
