import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ConnectedProjectContext } from "../state/connectedProject";
import type { ConnectedProject } from "../state/connectedProject";

/** Project regions show loading until their connection is ready, and failure if setup fails. */
export const InProject = (props: { open: ConnectedProject | undefined; failure?: Error | undefined; failed?: (failure: Error) => JSX.Element; pending?: JSX.Element; children: (open: ConnectedProject) => JSX.Element }) => (
  <Show when={props.open} keyed fallback={<Show when={props.failure} keyed fallback={props.pending}>{(failure) => props.failed?.(failure)}</Show>}>
    {(open) => <ConnectedProjectContext value={open}>{props.children(open)}</ConnectedProjectContext>}
  </Show>
);
