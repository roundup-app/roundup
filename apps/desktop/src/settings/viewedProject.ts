import { createEffect, createSignal, untrack } from "solid-js";
import type { ConnectedProject } from "../state/connectedProject";

/** U7887c: a link can name a Project other than the selected one; choosing another Project takes the page back to it. */
export const createViewedProject = (props: { project: () => string | null; connectionOf?: ((path: string) => ConnectedProject | undefined) | undefined }, gone: () => void) => {
  const [named, setNamed] = createSignal<string | null>(null);
  const viewed = () => named() ?? props.project();

  const connection = () => {
    const path = viewed();

    return path === null ? undefined : props.connectionOf?.(path);
  };

  createEffect(() => props.project(), () => { setNamed(null); }, { defer: true });
  createEffect(() => viewed(), path => { if (path === null) untrack(gone); }, { defer: true });

  return { viewed, connection, setNamed };
};
