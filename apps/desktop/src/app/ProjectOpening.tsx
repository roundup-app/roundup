import "./ProjectOpening.css";
import { createSignal, Show } from "solid-js";
import { Dialog } from "../ui/Dialog";
import type { ProjectsState } from "../state/projects";
import { RpcError, type ActionRequest, type ActionReply } from "./seam";
import { copy } from "./copy";

type OpenRequest = Extract<ActionRequest, { method: "project.open" }>;

type Confirmation = { request: OpenRequest; sourceName: string; choose: (open: boolean) => void };

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
        setPending(all => [...all, { request, sourceName: source.project.name, choose }]);
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

      return reply({ code: error instanceof RpcError ? error.code : -32603, message: error.message });
    }
  };

  return { pending: () => pending()[0], answer };
};

export const ProjectOpening = (props: { opening: ReturnType<typeof createProjectOpening> }) => <Show when={props.opening.pending()} keyed>{pending =>
  <Dialog.Root open instant onOpenChange={details => { if (!details.open) pending.choose(false); }}>
    <Dialog.Positioner><Dialog.Content class="app-dialog-form project-opening">
      <Dialog.Title>{copy.openProjectTitle}</Dialog.Title>
      <Dialog.Description>{copy.openProjectQuestion(pending.request.params.agent?.name ?? copy.openUser, pending.sourceName, pending.request.params.path)}</Dialog.Description>
      <footer class="app-dialog-actions">
        <button type="button" onClick={() => pending.choose(false)}>{copy.refuseProject}</button>
        <button type="button" class="accent" onClick={() => pending.choose(true)}>{copy.openProjectChoice}</button>
      </footer>
    </Dialog.Content></Dialog.Positioner>
  </Dialog.Root>
}</Show>;
