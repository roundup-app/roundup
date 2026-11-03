import "./ProjectOpening.css";
import { createSignal, Show } from "solid-js";
import { Dialog } from "../ui/Dialog";
import type { ProjectsState } from "../state/projects";
import { RpcError, type ActionRequest, type ActionReply } from "./seam";
import { copy } from "./copy";

type OpenRequest = Extract<ActionRequest, { method: "project.open" }>;

type Confirmation =
  | { kind: "confirmation"; request: OpenRequest; sourceName: string; choose: (open: boolean) => void }
  | { kind: "failure"; request: OpenRequest; message: string; dismiss: () => void };

/** One FIFO of request-bound decisions, owned by the App rather than the selected Project. */
export const createProjectOpening = (projects: ProjectsState) => {
  const [pending, setPending] = createSignal<Confirmation[]>([]);

  const answer = async (request: OpenRequest, signal: AbortSignal): Promise<ActionReply> => {
    const { id, params } = request;
    const reply = (error: { code: number; message: string }): ActionReply => ({ jsonrpc: "2.0", id, error });
    const lost = () => reply({ code: -32004, message: copy.openConnectionLost(params.path) });

    if (signal.aborted) return lost();
    const source = projects.tabs().find(tab => tab.project.path === params.source);

    if (!source) return lost();
    const known = projects.tabs().some(tab => tab.project.path === params.path && !tab.exit);

    if (!known) {
      const allowed = await new Promise<boolean>(resolve => {
        const choose = (open: boolean) => {
          signal.removeEventListener("abort", abort);
          setPending(all => all.filter(item => item.request !== request));
          resolve(open);
        };

        const abort = () => choose(false);
        signal.addEventListener("abort", abort, { once: true });
        setPending(all => [...all, { kind: "confirmation", request, sourceName: source.project.name, choose }]);
      });

      if (signal.aborted) return lost();

      if (!allowed) return reply({ code: -32002, message: copy.openRefused(params.path) });
    }

    if (signal.aborted) return lost();

    try {
      const opened = await projects.openRequested(params.path);

      if (signal.aborted) return lost();

      return { jsonrpc: "2.0", id, result: { path: opened.path } };
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      if (!signal.aborted) setPending(all => [...all, {
        kind: "failure", request, message: error.message,
        dismiss: () => setPending(all => all.filter(item => item.request !== request)),
      }]);

      return reply({ code: error instanceof RpcError ? error.code : -32603, message: copy.openProjectRecovery(params.path, error.message) });
    }
  };

  return { pending: () => pending()[0], answer };
};

export const ProjectOpening = (props: { opening: ReturnType<typeof createProjectOpening> }) => <Show when={props.opening.pending()} keyed>{pending =>
  <Dialog.Root open instant onOpenChange={details => { if (!details.open) {
    if (pending.kind === "confirmation") pending.choose(false);
    else pending.dismiss();
  } }}>
    <Dialog.Positioner><Dialog.Content class="app-dialog-form project-opening">
      <Dialog.Title>{pending.kind === "confirmation" ? copy.openProjectTitle : copy.openProjectFailed}</Dialog.Title>
      <Dialog.Description>{pending.kind === "confirmation"
        ? copy.openProjectQuestion(pending.request.params.agent?.name ?? copy.openUser, pending.sourceName, pending.request.params.path)
        : copy.openProjectRecovery(pending.request.params.path, pending.message)}</Dialog.Description>
      <footer class="app-dialog-actions">
        <Show when={pending.kind === "confirmation" ? pending : null} fallback={<button type="button" onClick={() => { if (pending.kind === "failure") pending.dismiss(); }}>{copy.close}</button>}>{confirmation => <>
          <button type="button" onClick={() => confirmation().choose(false)}>{copy.refuseProject}</button>
          <button type="button" class="accent" onClick={() => confirmation().choose(true)}>{copy.openProjectChoice}</button>
        </>}</Show>
      </footer>
    </Dialog.Content></Dialog.Positioner>
  </Dialog.Root>
}</Show>;
