import { flush, lazy, Show } from "solid-js";
import type { SearchHit } from "@contracts/search/SearchHit";
import { DialogFailure, StatusNote } from "../ink/MountedLine";
import { Icon } from "../ink/Icon";
import { KindGlyph } from "../ink/KindGlyph";
import { PAD_ICON } from "../shelf/frame";
import { openThroughRow } from "../shelf/openItem";
import type { useConnectedProject } from "../state/connectedProject";
import { copy } from "./copy";
import { Marked } from "./Marked";
import type { Entry } from "./entries";
import { foundValue, type createTextSearch } from "./textSearch";

const TodoHost = lazy(() => import("../todos/TodoDrawer").then(module => ({ default: module.TodoHost })));

const PadHost = lazy(() => import("../pads/PadDrawer").then(module => ({ default: module.PadHost })));

/** U7707a: a hit that already shows as a title row is not listed twice. */
export const untitledHits = (hits: readonly SearchHit[], items: readonly Entry[]): Entry[] => {
  const titled = new Set(items.flatMap(entry => entry.kind === "todo" ? [`todo:${entry.todo.id}`] : entry.kind === "pad" ? [`pad:${entry.pad.name}`] : []));

  return hits.flatMap((hit): Entry[] => titled.has(`${hit.kind}:${hit.id}`) ? [] : [{ value: foundValue(hit), label: hit.title, kind: "found", hit }]);
};

type Connected = ReturnType<typeof useConnectedProject>;

/** U5240b: the Rail's own row opens a Todo or Pad when the Shelf is mounted; otherwise the Drawer opens alone. */
export const openItem = ({ drawer, project }: Pick<Connected, "drawer" | "project">, kind: "todo" | "pad", id: string): void => {
  if (kind === "todo" ? openThroughRow("todo", Number(id)) : openThroughRow("pad", id)) return;

  drawer.open(() => kind === "todo" ? <TodoHost id={Number(id)} /> : <PadHost name={id} />, "key", { kind, project: project.path });
};

/** U7707b: a Pad or Todo opens as its title row does; a Message selects the Rail row of its Agent and focuses its pane, and with no such row opens nothing and says so. */
export const chooseHit = (hit: SearchHit, on: {
  connected: Pick<Connected, "drawer" | "project" | "rail">;
  closeWith: (how: { kind: "item" } | { kind: "pane"; terminal: null }) => void;
  onFailure: (message: string | null) => void;
  gone: (value: string) => void;
}): void => {
  if (hit.kind === "message") {
    const agent = on.connected.rail.nodes.find(node => node.id === hit.opens);

    if (!agent) return on.gone(foundValue(hit));

    on.connected.rail.select(agent.id);
    flush();
    on.closeWith({ kind: "pane", terminal: null });
    on.onFailure(null);

    return;
  }

  on.closeWith({ kind: "item" });
  on.onFailure(null);
  openItem(on.connected, hit.kind, hit.id);
};

/** U7707b: a Message's `<from> to <to>` title with each Agent id shown as its Rail name, never the raw id. */
export const messageTitle = (title: string, nodes: readonly { id: string; name: string }[]): string => {
  const name = (id: string) => nodes.find(node => node.id === id)?.name ?? id;
  const join = ` ${copy.messageTo} `;
  const at = title.indexOf(join);

  return at < 0 ? title : `${name(title.slice(0, at))}${join}${name(title.slice(at + join.length))}`;
};

export const FoundRow = (props: { hit: SearchHit; nodes: readonly { id: string; name: string }[] }) => <span class="switcher-row switcher-found">
  {props.hit.kind === "pad" ? <Icon name={PAD_ICON} /> : props.hit.kind === "todo" ? <KindGlyph kind="idle" decorative /> : <Icon name="talk" />}
  <span class="switcher-kind">{props.hit.kind === "todo" ? copy.kindTodo : props.hit.kind === "pad" ? copy.kindPad : copy.kindMessage}</span>
  <span class="switcher-name">{props.hit.kind === "message" ? messageTitle(props.hit.title, props.nodes) : props.hit.title}</span>
  <span class="switcher-snippet"><Marked text={props.hit.snippet} ranges={props.hit.ranges} /></span>
</span>;

/** U7707c, U7707d: the group's own states, beside the rows it never holds back: `Searching` once a reply is slow, a failure with its retry, and a line when the Daemon had more. */
export const SearchStatus = (props: { search: ReturnType<typeof createTextSearch> }) => <>
  <StatusNote text={props.search.searching() && copy.searching} live="polite" class="switcher-searching" />
  <DialogFailure message={props.search.failure()} dismiss={props.search.dismiss} recover={{ run: props.search.retry }} />
  <Show when={props.search.more()}><p class="switcher-text-more">{copy.moreMatches}</p></Show>
</>;
