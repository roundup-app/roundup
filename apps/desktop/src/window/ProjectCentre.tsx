import Hourglass from "lucide-solid/icons/hourglass";
import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { Bubbles } from "../bubbles/Bubbles";
import { ResumeBar } from "../continuation/ResumeBar";
import { copy } from "./copy";
import { InProject } from "./InProject";
import { failureLine } from "../ink/ReservedLine";
import { captureActions } from "../keys/registry";
import { ProjectSettingsView } from "../rail/ProjectSettings";
import { ResourceStrip } from "../resources/ResourceStrip";
import type { ConnectedProject } from "../state/connectedProject";
import type { createProjectPanes } from "../terminal/ProjectPanes";
import type { ToastQueue } from "../toasts/queue";

/** U7155a: the centre of a Project view; the kept Panes sit in `panes`, and `children` mount around them once the Project is connected. */
export const ProjectCentre = (props: {
  panes: ReturnType<typeof createProjectPanes>;
  open: ConnectedProject | undefined;
  failure: Error | undefined;
  retry: () => void;
  notify: ToastQueue["notify"];
  children: JSX.Element;
}) => (
  <div class="centre-stack">
    <div class="project-center-area">
      <div class="project-center-content" inert={props.open?.settingsView.open()} style={{ visibility: props.open?.settingsView.open() ? "hidden" : "visible" }}>
        <div class="pane-stack">{props.panes.view()}<InProject open={props.open}>{() => <ResumeBar notify={props.notify} />}</InProject></div>
        <InProject open={props.open}>{() => props.children}</InProject>
      </div>
      <InProject
        open={props.open}
        failure={props.failure}
        failed={failure => <div class="project-pending">{failureLine(failure, props.retry)}</div>}
        pending={<div class="project-pending"><div role="img" aria-label={copy.loadingProject} class="light" style={{ padding: "var(--space-4)" }}><Hourglass class="icon" aria-hidden="true" /></div></div>}
      >
        {() => <ProjectSettingsView />}
      </InProject>
    </div>
    <InProject open={props.open}>
      {(open) => (
        <>
          <Show when={props.panes.screensOf(open.project.path)}>{(shared) => <Bubbles screens={shared()} />}</Show>
          <ResourceStrip returnFocus={() => props.panes.focusSelected(open, () => captureActions(document.activeElement).find(action => action.value === "action:chord:⌘/")?.run())} />
        </>
      )}
    </InProject>
  </div>
);
