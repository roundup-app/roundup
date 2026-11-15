import Hourglass from "lucide-solid/icons/hourglass";
import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { AskBar } from "../ask/AskBar";
import { Bubbles } from "../bubbles/Bubbles";
import { copy } from "./copy";
import { Feedback } from "../feedback/Feedback";
import { failureLine } from "../ink/ReservedLine";
import { captureActions } from "../keys/registry";
import { ProjectSettingsView } from "../rail/ProjectSettings";
import { ResourceStrip } from "../resources/ResourceStrip";
import { isDoor } from "../state/doorNode";
import { ConnectedProjectContext } from "../state/connectedProject";
import type { ConnectedProject } from "../state/connectedProject";
import { Switcher } from "../switcher/Switcher";
import type { createProjectPanes } from "../terminal/ProjectPanes";
import type { ToastQueue } from "../toasts/queue";

const InOpen = (props: { open: ConnectedProject | undefined; children: (open: ConnectedProject) => JSX.Element }) => (
  <Show when={props.open} keyed>{open => <ConnectedProjectContext.Provider value={open}>{props.children(open)}</ConnectedProjectContext.Provider>}</Show>
);

/** U7155a: the centre of a Project view; the kept Panes sit in `panes`, and the Project's own surfaces mount around them once it is connected. */
export const ProjectCentre = (props: {
  panes: ReturnType<typeof createProjectPanes>;
  open: ConnectedProject | undefined;
  failure: Error | undefined;
  retry: () => void;
  viewLabel: (id: string) => string | undefined;
  notify: ToastQueue["notify"];
  onFailure: (failure: string | null) => void;
  onSwitcherOpen: () => void;
}) => (
  <div class="centre-stack">
    <div class="project-center-area">
      <div class="project-center-content" inert={props.open?.settingsView.open()} style={{ visibility: props.open?.settingsView.open() ? "hidden" : "visible" }}>
        <div class="pane-stack">{props.panes.view()}</div>
        <InOpen open={props.open}>
          {() => (
            <>
              <AskBar viewLabel={props.viewLabel} />
              <Feedback notify={props.notify} />
              <Switcher notify={props.notify} onFailure={props.onFailure} onOpen={props.onSwitcherOpen} />
            </>
          )}
        </InOpen>
      </div>
      <InOpen open={props.open}>{() => <ProjectSettingsView />}</InOpen>
      <Show when={props.open === undefined}>
        <div class="project-pending">
          <Show when={props.failure} keyed fallback={<div role="img" aria-label={copy.loadingProject} class="light" style={{ padding: "var(--space-4)" }}><Hourglass class="icon" aria-hidden="true" /></div>}>{failure => failureLine(failure, props.retry)}</Show>
        </div>
      </Show>
    </div>
    <InOpen open={props.open}>
      {(open) => (
        <>
          <Show when={props.panes.screensOf(open.project.path)}>{(shared) => <Bubbles screens={shared()} />}</Show>
          <ResourceStrip returnFocus={() => {
            const node = open.rail.nodes.find(candidate => candidate.id === open.rail.selected());
            const id = node && isDoor(node) ? node.terminal_id : undefined;

            if (id) props.panes.screensOf(open.project.path)?.emulatorFor(id).focus();
            else captureActions(document.activeElement).find(action => action.value === "action:chord:⌘/")?.run();
          }} />
        </>
      )}
    </InOpen>
  </div>
);
