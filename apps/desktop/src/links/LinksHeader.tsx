import "./styles.css";
import ChevronDown from "@lucide/solid/icons/chevron-down";
import ChevronUp from "@lucide/solid/icons/chevron-up";
import { createMemo, createSignal, lazy, onCleanup, Show } from "solid-js";
import { isDoor } from "../state/doorNode";
import { openDeliverable } from "../ask/openDeliverable";
import { useConnectedProject } from "../state/connectedProject";
import { IconButton } from "../ui/IconButton";
import { inlineFor, LinksView, specOf } from "./catalogue";
import { copy } from "./copy";

const PadHost = lazy(() => import("../pads/PadDrawer").then(module => ({ default: module.PadHost })));

const TodoHost = lazy(() => import("../todos/TodoDrawer").then(module => ({ default: module.TodoHost })));

/**
 * LH6 to LH10: the links header, laid over the top edge of the shown Agent's Terminal (Pane's `header`), out of the layout flow, so it
 * never resizes the Terminal. It collapses to a thin handle while the Agent's Status is working and shows in full on any other Kind;
 * the user's toggle holds until the Status revision changes. It opens nothing but on a click.
 */
export const LinksHeader = (props: { active: () => boolean }) => {
  const { app, rail, project, links, made, drawer, createIn } = useConnectedProject();
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

  // LH13: the header is one row inside the inset, so the icons that do not fit the pane's width fold into the count.
  const [width, setWidth] = createSignal(Infinity);

  const watch = (el: HTMLElement) => {
    if (typeof ResizeObserver === "undefined") return;

    // The ref runs before the element is attached, so its pane is read a microtask later.
    const observer = new ResizeObserver(() => setWidth(el.parentElement?.clientWidth || Infinity));

    queueMicrotask(() => { if (el.parentElement) observer.observe(el.parentElement); });
    onCleanup(() => observer.disconnect());
  };

  const spec = (id: string) => specOf(links.read(id), made.read(id));

  const total = (id: string) => (links.read(id)?.entries.length ?? 0) + made.read(id).length + 2;

  const folder = () => door()?.worktree?.path ?? project.path;

  const env = {
    editor: () => void app.openInEditor(folder()).catch(error => console.error(error)),
    terminal: () => {
      const id = door()?.id;

      if (id) createIn("terminal", id);
    },
    made: (item: { kind: "pad" | "todo" | "file"; id: string }) => {
      const agent = door()?.id;

      if (item.kind === "pad") drawer.open(() => <PadHost name={item.id} />, "pointer", { kind: "pad", project: project.path });
      else if (item.kind === "todo") drawer.open(() => <TodoHost id={Number(item.id)} />, "pointer", { kind: "todo", project: project.path });
      // LH22: a file opens as Made opens a Deliverable (DV5); a gone one shows no error and the list is read again.
      else void openDeliverable(app, project.path, item.id).then(cause => { if (cause && agent) made.refresh(agent); }, error => console.error(error));
    },
    open: (url: string) => void app.openTarget({ kind: "url", url }).catch(error => console.error(error)),
  };

  return (
    <Show when={props.active() && door()}>
      {node => (
        <div ref={watch} class="links-header" role="group" aria-label={copy.region} data-open={open() ? "" : undefined} data-agent={node().id}>
          <Show when={open()}><LinksView spec={spec(node().id)} env={env} shown={inlineFor(width(), total(node().id))} /></Show>
          <IconButton class="links-handle" aria-label={open() ? copy.collapse : copy.expand} aria-expanded={open() ? "true" : "false"} onClick={() => setToggled({ revision: revision(), open: !open() })}>
            <Show when={open()} fallback={<ChevronDown size={14} aria-hidden="true" />}><ChevronUp size={14} aria-hidden="true" /></Show>
          </IconButton>
        </div>
      )}
    </Show>
  );
};
