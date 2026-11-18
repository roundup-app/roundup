import "./styles.css";
import ChevronDown from "@lucide/solid/icons/chevron-down";
import ChevronUp from "@lucide/solid/icons/chevron-up";
import { createMemo, createSignal, Show } from "solid-js";
import { isDoor } from "../state/doorNode";
import { useConnectedProject } from "../state/connectedProject";
import { IconButton } from "../ui/IconButton";
import { LinksView, specOf } from "./catalogue";
import { copy } from "./copy";

/**
 * LH6 to LH10: the links header, laid over the top edge of the shown Agent's Terminal (Pane's `header`), out of the layout flow, so it
 * never resizes the Terminal. It collapses to a thin handle while the Agent's Status is working and shows in full on any other Kind;
 * the user's toggle holds until the Status revision changes. It opens nothing but on a click.
 */
export const LinksHeader = (props: { active: () => boolean }) => {
  const { app, rail, project, links, createIn } = useConnectedProject();
  const [toggled, setToggled] = createSignal<{ revision: string; open: boolean } | null>(null);

  const door = createMemo(() => {
    const node = rail.nodes.find(each => each.id === rail.selected());

    return node && isDoor(node) ? node : undefined;
  });

  // A Status with no revision yet (a starting row) is told apart by the time it began.
  const revision = () => {
    const node = door();

    return node ? `${node.status_revision ?? ""}:${node.status?.since ?? ""}:${node.status?.kind ?? ""}` : "";
  };

  const open = () => {
    const kept = toggled();

    return kept && kept.revision === revision() ? kept.open : door()?.status?.kind !== "working";
  };

  const folder = () => door()?.worktree?.path ?? project.path;

  const env = {
    editor: () => void app.openInEditor(folder()).catch(error => console.error(error)),
    terminal: () => {
      const id = door()?.id;

      if (id) createIn("terminal", id);
    },
    open: (url: string) => void app.openTarget({ kind: "url", url }).catch(error => console.error(error)),
  };

  return (
    <Show when={props.active() && door()}>
      {node => (
        <div class="links-header" role="group" aria-label={copy.region} data-open={open() ? "" : undefined} data-agent={node().id}>
          <Show when={open()}><LinksView spec={specOf(links.read(node().id))} env={env} /></Show>
          <IconButton class="links-handle" aria-label={open() ? copy.collapse : copy.expand} aria-expanded={open() ? "true" : "false"} onClick={() => setToggled({ revision: revision(), open: !open() })}>
            <Show when={open()} fallback={<ChevronDown size={14} aria-hidden="true" />}><ChevronUp size={14} aria-hidden="true" /></Show>
          </IconButton>
        </div>
      )}
    </Show>
  );
};
