import { createSignal, onCleanup, untrack } from "solid-js";
import type { Check } from "@contracts/feedback/Check";
import type { Filed } from "@contracts/feedback/Filed";
import type { App, FeedbackReport } from "../app/seam";
import { CHORDS } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import type { ToastQueue } from "../toasts/queue";
import { copy } from "./copy";
import { versionsText } from "./facts";

/** What the shot left: the window as drawn, or why there is none. */
type Opened = { capture: FeedbackReport | null; cause: string | null };

/** The window as drawn now, or why there is none. */
const takeShot = async (app: Pick<App, "feedbackCapture">): Promise<Opened> => {
  let capture: FeedbackReport | null = null;
  let cause: string | null = null;

  try {
    if (app.feedbackCapture) capture = await app.feedbackCapture();
    else cause = copy.noCapture;
  } catch (error) {
    if (!(error instanceof Error)) throw error;

    cause = error.message;
  }

  return {
    capture,
    cause:
      cause ?? capture?.shot_error ?? (capture?.shot ? null : copy.noCapture),
  };
};

/** U7210a to U7210e: a request takes the shot, then opens the dialog; Send files one Issue and closes it, a failure keeps it open with the text. */
export const createFeedbackSession = (props: {
  notify: ToastQueue["notify"];
}) => {
  const { app, project } = useConnectedProject();
  const [opened, setOpened] = createSignal<Opened | null>(null);
  const [capturing, setCapturing] = createSignal(false);
  const [check, setCheck] = createSignal<Check | null>(null);
  const [checkFailure, setCheckFailure] = createSignal<string | null>(null);
  const [text, setText] = createSignal("");
  const [attach, setAttach] = createSignal(true);
  const [sending, setSending] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);

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

  /** The screenshot is offered only where Send is, and only to a `gh` that attaches it. */
  const attached = () =>
    shot() !== null && check()?.attach === true && blocked() === null;

  const noShotLine = () => {
    const cause = opened()?.cause;
    const known = check();

    if (shot() === null) return cause ? copy.noShot(cause) : null;

    return known !== null && !known.attach && blocked() === null
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
    const taken = await takeShot(app);

    setCapturing(false);
    setText("");
    setAttach(true);
    setSending(false);
    setFailure(null);
    setOpened(taken);
  };

  registerKeys({ kind: "app" }, [
    {
      action: CHORDS["feedback.open"],
      capture: () => ({
        available: () => opened() === null && !capturing(),
        invoke: () => void begin(),
      }),
    },
  ]);
  onCleanup(untrack(() => app.onFeedback(begin)));

  const canSend = () =>
    opened() !== null &&
    !sending() &&
    text().trim() !== "" &&
    check() !== null &&
    blocked() === null;

  const send = async () => {
    const current = opened();

    if (!current || !canSend()) return;

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

  return {
    isOpen: () => opened() !== null,
    close: () => setOpened(null),
    text,
    setText,
    attach,
    setAttach,
    sending,
    failure,
    setFailure,
    check,
    checkFailure,
    versions,
    blocked,
    attached,
    noShotLine,
    canSend,
    send,
  };
};
