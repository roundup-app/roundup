import "./styles.css";
import { createEffect, Show, untrack } from "solid-js";
import { unknownOutcomeLine } from "../app/failureOf";
import { dismissable, RecoveryButtons } from "../ink/recovery";
import { FloatingLine } from "../ink/FloatingLine";
import { focusCentre, queueFocus } from "../keys/focus";
import { createMessageToast } from "../ink/messageToast";
import { LEADER } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import type { Tally } from "../state/continuation";
import type { ToastQueue } from "../toasts/queue";
import { copy } from "./copy";

const lineOf = ({ resumed, failed }: Tally): string => {
  if (failed > 0) return copy.resumedSome(resumed, resumed + failed);

  return resumed > 0 ? copy.resumedAgents(resumed) : copy.nothingToResume;
};

/**
 * U7211a to U7211c: the one slim line in the Terminal's top inset (Pane's `over`). It says so when the shown Project's
 * selected Agent has unfinished work the user has not dismissed, with Resume and Dismiss, and stays empty and hidden otherwise; showing it
 * resizes nothing (U3807, U4590) and lies within the inset, off every row (LH12). It never resumes by itself. `⌘K U` and the command
 * list resume every Agent's, while one has some, and a Toast says how many resumed. A failed resume, or a failed read of
 * unfinished work, shows as a Toast with its retry and Dismiss (U7314g); the line is only the notice and holds no failure.
 */
export const ResumeBar = (props: { notify: ToastQueue["notify"]; active: () => boolean }) => {
  const { rail, continuation: work, project } = useConnectedProject();
  const id = () => rail.selected() ?? "";

  const unchecked = dismissable(() => {
    const error = work.readFailure();

    return error === null ? null : copy.checkFailed(unknownOutcomeLine(error));
  });

  const pending = () => work.shown(id());

  const failed = (): string | null => {
    const error = work.failure(id());

    return error === null ? null : unknownOutcomeLine(error);
  };

  const message = () => pending() ? failed() : unchecked.message();
  const visible = () => pending() || !!message();
  const dismiss = () => pending() ? work.dismiss(id()) : unchecked.dismiss();
  const recover = () => pending() ? { run: () => work.resume(id()), label: copy.resume } : { run: work.reread };

  const report = (tally: Tally) => props.notify({ key: `resume:${project.path}`, item: `resume:${project.path}`, project: project.path, selected: false, kind: tally.failed > 0 ? "error" : "done", name: copy.title, line: lineOf(tally), open: () => null });

  registerKeys({ kind: "leader" }, [{ action: LEADER["leader.resume"], capture: () => ({ available: () => props.active() && work.count() > 0, invoke: () => void work.resumeAll().then(report) }) }]);

  createEffect(visible, (now, was) => {
    if (untrack(props.active) && was && !now && document.activeElement === document.body) queueFocus(() => void focusCentre());
  });

  createMessageToast({ started: true, get message() { return message(); }, dismiss, get recover() { return recover(); } });

  return (
    <FloatingLine
      class="resume-bar"
      status={pending() && !message() ? work.busy(id()) ? copy.resuming : copy.stopped : null}
      action={<Show when={pending() && !message()}><RecoveryButtons dismiss={dismiss} recover={work.busy(id()) ? undefined : recover()} /></Show>}
      onKeyDown={event => {
        if (event.key !== "Escape") return;

        event.stopPropagation();
        dismiss();
      }}
    />
  );
};
