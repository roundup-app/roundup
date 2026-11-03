import "./ProjectOpening.css";
import { createComputed, createSignal, Show } from "solid-js";
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

    try {
      const source = await projects.opened(params.source);

      if (!source) return lost();
      const known = await projects.opened(params.path);

      if (signal.aborted) return lost();

      if (!known) {
        const allowed = await new Promise<boolean>(resolve => {
          const choose = (open: boolean) => {
            signal.removeEventListener("abort", abort);
            setPending(all => all.filter(item => item.request !== request));
            resolve(open);
          };

          const abort = () => choose(false);
          signal.addEventListener("abort", abort, { once: true });
          setPending(all => [...all, { kind: "confirmation", request, sourceName: source.name, choose }]);
        });

        if (signal.aborted) return lost();

        if (!allowed) return reply({ code: -32002, message: copy.openRefused(params.path) });
      }

      if (signal.aborted) return lost();

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

export const ProjectOpening = (props: { opening: ReturnType<typeof createProjectOpening> }) => {
  let returnFocus: HTMLElement | null = null;

  createComputed(() => {
    const pending = props.opening.pending();
    const focused = document.activeElement;

    // A failed open replaces consent before Ark can return focus; keep its connected background target.
    if (pending && focused instanceof HTMLElement && focused !== document.body && !focused.closest('[role="dialog"]')) returnFocus = focused;
  });

  return <Dialog.Root finalFocusEl={() => returnFocus?.isConnected ? returnFocus : null} open={props.opening.pending() !== undefined} instant onOpenChange={details => {
    const pending = props.opening.pending();

    if (details.open || !pending) return;

    if (pending.kind === "confirmation") pending.choose(false);
    else pending.dismiss();
  }}>
    <Show when={props.opening.pending()}>{pending => {
      const confirmation = () => { const current = pending();

 return current.kind === "confirmation" ? current : undefined; };

      const failure = () => { const current = pending();

 return current.kind === "failure" ? current : undefined; };

      return <Dialog.Positioner><Dialog.Content class="app-dialog-form project-opening">
        <Dialog.Title>{pending().kind === "confirmation" ? copy.openProjectTitle : copy.openProjectFailed}</Dialog.Title>
        <Dialog.Description>
          <Show when={confirmation()} fallback={copy.openProjectRecovery(pending().request.params.path, failure()?.message ?? "")}>
            {confirmation => <>
              {copy.openProjectQuestion(confirmation().request.params.agent?.name ?? copy.openUser, confirmation().sourceName)}
              <span class="project-opening-path">{pending().request.params.path}</span>
            </>}
          </Show>
        </Dialog.Description>
        <footer class="app-dialog-actions">
          <Show when={confirmation()} fallback={<button type="button" data-button="quiet" onClick={() => failure()?.dismiss()}>{copy.close}</button>}>{confirmation => <>
            <button type="button" data-button="quiet" onClick={() => confirmation().choose(false)}>{copy.refuseProject}</button>
            <button type="button" data-button="primary" onClick={() => confirmation().choose(true)}>{copy.openProjectChoice}</button>
          </>}</Show>
        </footer>
      </Dialog.Content></Dialog.Positioner>;
    }}</Show>
  </Dialog.Root>;
};
