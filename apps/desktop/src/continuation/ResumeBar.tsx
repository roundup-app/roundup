import "./styles.css";
import { createEffect, on, Show } from "solid-js";
import { RpcError } from "../app/seam";
import { dismissable, RecoveryButtons, ReservedLine } from "../ink/ReservedLine";
import { focusCentre, queueFocus } from "../keys/focus";
import { LEADER } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { isDoor } from "../state/doorNode";
import type { Tally } from "../state/continuation";
import type { ToastQueue } from "../toasts/queue";
import { copy } from "./copy";

const reason = (error: Error): string => copy.rpcFailure(error instanceof RpcError ? error.code : 0);

const lineOf = ({ resumed, failed }: Tally): string => {
  if (failed > 0) return copy.resumedSome(resumed, resumed + failed);

  return resumed > 0 ? copy.resumedAgents(resumed) : copy.nothingToResume;
};

/**
 * U7211a to U7211c: the one slim line in the row above the selected Agent's Terminal, which every Agent's Terminal
 * reserves. It says so when the Agent has unfinished work the user has not dismissed, with Resume and Dismiss, and stays
 * empty otherwise, so showing it moves nothing (U3807) and covers no output (U7192). It never resumes by itself. `⌘K U` and the command
 * list resume every Agent's, while one has some, and a Toast says how many resumed. When the read of unfinished work
 * fails the line says so instead, with a retry.
 */
export const ResumeBar = (props: { notify: ToastQueue["notify"] }) => {
  const { rail, continuation: work, project } = useConnectedProject();
  const id = () => rail.selected() ?? "";

  /** Every Agent's Terminal frame reserves this row, so the line showing or going moves nothing and covers no output. */
  const framed = () => rail.nodes.some(node => node.id === id() && isDoor(node) && node.attempt !== null && node.terminal_id !== null);

  const unchecked = dismissable(() => {
    const error = work.readFailure();

    return error === null ? null : copy.checkFailed(reason(error));
  });

  const pending = () => work.shown(id());

  const failed = (): string | null => {
    const error = work.failure(id());

    return error === null ? null : reason(error);
  };

  const message = () => pending() ? failed() : unchecked.message();
  const visible = () => pending() || !!message();
  const dismiss = () => pending() ? work.dismiss(id()) : unchecked.dismiss();
  const recover = () => pending() ? { run: () => void work.resume(id()), label: copy.resume } : { run: work.reread };

  const report = (tally: Tally) => props.notify({ key: `resume:${project.path}`, item: `resume:${project.path}`, project: project.path, selected: false, kind: tally.failed > 0 ? "error" : "done", name: copy.title, line: lineOf(tally), open: () => null });

  registerKeys({ kind: "leader" }, [{ action: LEADER["leader.resume"], capture: () => ({ available: () => work.count() > 0, invoke: () => void work.resumeAll().then(report) }) }]);

  createEffect(on(visible, (now, was) => {
    if (was && !now && document.activeElement === document.body) queueFocus(() => void focusCentre());
  }, { defer: true }));

  return (
    <Show when={framed()}>
      <ReservedLine
        class="resume-bar"
        message={message()}
        status={visible() ? work.busy(id()) ? copy.resuming : copy.stopped : null}
        dismiss={dismiss}
        recover={recover()}
        action={<Show when={pending() && !message()}><RecoveryButtons dismiss={dismiss} recover={work.busy(id()) ? undefined : recover()} /></Show>}
        onKeyDown={event => {
          if (event.key !== "Escape") return;

          event.stopPropagation();
          dismiss();
        }}
      />
    </Show>
  );
};
