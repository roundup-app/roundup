import { copy, menuBarCopy } from "./copy";
import type * as Solid from "solid-js";
import type { ConnectedProject, createProjectDrafts } from "../state/connectedProject";
import type { OpenTab } from "../state/projects";
import type { App, MenuBar, MenuItem } from "../app/seam";
import { captureActions } from "../keys/registry";
import { CHORDS, LEADER, leaderKeys, shortcutLabel } from "../keys/chords";
import { historyRegion } from "../keys/focus";
import type { Kind } from "@contracts/Kind";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const HOUR = 3_600_000;

/** U5959a: the disc's state; the Kind Glyph of `glyphOf` picks amber `!` and red cross, Ready takes the accent check. */
const stateOf = (kind: Kind, waiting: boolean): "needs-you" | "error" | "ready" => (!waiting ? "ready" : kind === "error" ? "error" : "needs-you");

/** U5959a: hyphens become spaces and the first letter is capital; the rest stays literal. */
const sentence = (text: string) => {
  const [first, ...rest] = [...graphemes.segment(literal(text).replaceAll("-", " "))].map(part => part.segment);

  return first === undefined ? "" : first.toUpperCase() + rest.join("");
};

const literal = (text: string) => text.replace(/[\r\n\u2028\u2029]+/g, " ");


const short = (text: string) => {
  const parts = [...graphemes.segment(literal(text))].map(part => part.segment);

  return parts.length > 24 ? parts.slice(0, 23).join("") + "…" : parts.join("");
};

/** U5502: only the connected App owns membership; the native shell presents literal rows. */
export const watchMenuBar = (options: {
  solid: Pick<typeof Solid, "createEffect" | "createSignal" | "onCleanup">;
  app: App;
  tabs: () => OpenTab[];
  connection: (path: string) => ConnectedProject | undefined;
  select: (path: string, agent: string) => void;
  open: () => void;
  /** The line the user sees: a publication read that failed, so a marker stays unread. */
  fail: (message: string | null) => void;
  /** U6249d: a refusal by the native shell is not the user's to act on; the log holds it. */
  hide: (cause: string) => void;
}) => {
  const { createEffect, createSignal, onCleanup } = options.solid;
  const [turn, setTurn] = createSignal(0);
  const waitingSince = new Map<string, { kind: Kind; attempt: string | null; since: number }>();
  createEffect(() => {
    turn();
    const tabs = options.tabs();
    const current = new Set<string>();

    const rows = tabs.flatMap(tab => {
      const connection = options.connection(tab.project.path);

      if (!connection || tab.exit) return [];

      return connection.rail.nodes.flatMap(node => {
        const status = node.status;

        if (!status || node.alert_level === "quiet" || (node.kind === "workstream" && node.attempt === null)) return [];

        const waiting = status.kind === "needs-you" || status.kind === "error" && !connection.rail.dismissed(node);
        const publication = connection.unseen.publicationAt(node.id);
        const finish = connection.unseen.of(node.id);
        const ready = finish || publication !== null;
        const key = JSON.stringify([tab.project.path, node.id]);
        current.add(key);

        const prior = waitingSince.get(key);

        if (!waiting) waitingSince.delete(key);
        else if (prior?.kind !== status.kind || prior?.attempt !== node.attempt) waitingSince.set(key, { kind: status.kind, attempt: node.attempt, since: status.since });

        if (!waiting && !ready) return [];

        const since = waiting ? waitingSince.get(key)!.since : Math.max(finish ? connection.unseen.finishAt(node.id) : 0, publication ?? 0);

        return [{ path: tab.project.path, agent: node.id, waiting, since, state: stateOf(status.kind, waiting),
          label: sentence(node.name), subtitle: menuBarCopy.subtitle(short(status.label), tabs.length > 1 ? literal(tab.project.name) : null) }];
      });
    }).sort((a, b) => Number(b.waiting) - Number(a.waiting)
      || (a.waiting ? a.since - b.since : b.since - a.since)
      || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
      || (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0));

    for (const key of waitingSince.keys()) {
      if (!current.has(key)) waitingSince.delete(key);
    }

    // U5959b: Ready keeps the last hour; older Ready Agents fold into `n earlier…`. Date.now, not the App display clock: R17 counts that clock's reads; U5970 re-runs this on one timer.
    const now = Date.now();
    const shown = rows.filter(row => row.waiting || now - row.since <= HOUR);
    const earlier = rows.length - shown.length;

    // U5970: one timer for the first moment a kept Ready row passes the hour; each projection re-arms it.
    const fresh = shown.filter(row => !row.waiting).map(row => row.since + HOUR + 1 - now);

    if (fresh.length) {
      const timer = setTimeout(() => setTurn(count => count + 1), Math.min(...fresh));
      onCleanup(() => clearTimeout(timer));
    }

    const entries = (limit: number): MenuBar["entries"] => {
      const result: MenuBar["entries"] = [];
      let group: boolean | undefined;

      for (const row of shown.slice(0, limit)) {
        if (group !== row.waiting) result.push({ label: row.waiting ? menuBarCopy.waiting : menuBarCopy.ready, head: true, action: null });
        group = row.waiting;
        result.push({ label: row.label, subtitle: row.subtitle, state: row.state, since: row.since, action: { kind: "agent", path: row.path, agent: row.agent } });
      }

      if (shown.length === 0) result.push({ label: menuBarCopy.empty, action: null });

      if (earlier > 0) result.push({ label: menuBarCopy.earlier(earlier), action: { kind: "open" } });

      if (shown.length > limit) result.push({ label: menuBarCopy.more(shown.length - limit), action: { kind: "open" } });
      result.push({ label: menuBarCopy.open, action: { kind: "open" } });

      return result;
    };

    const menu: MenuBar = { mark: rows.some(row => row.waiting) ? "waiting" : rows.length ? "ready" : "empty", entries: entries(7), dock: entries(5) };
    const failure = tabs.map(tab => options.connection(tab.project.path)?.unseen.publicationFailure()).find(Boolean) ?? null;

    void options.app.setMenuBar(menu).then(() => options.fail(failure), error => options.hide(String(error)));
  });

  const stop = options.app.onMenuBarAction(action => {
    if (action.kind === "failure") { options.hide(action.message);

 return; }

    options.open();

    if (action.kind === "agent") {
      const rail = options.connection(action.path)?.rail;

      // U6249d: a row whose Agent is gone drops without a message.
      if (options.tabs().some(tab => tab.project.path === action.path) && rail?.nodes.some(node => node.id === action.agent)) {
        options.fail(null);
        options.select(action.path, action.agent);
      }
    }

    void options.app.showWindow().catch(error => options.hide(String(error)));
  });

  onCleanup(stop);
};

type TodoUndo = ReturnType<ReturnType<typeof createProjectDrafts>>["todoUndo"];

/** The one Undo or Redo the key (⌘Z, ⇧⌘Z) and the Project menu both run; it names what it would do and whether it can. */
export const undoAction = (history: TodoUndo | null, redo: boolean, focus: Element | null) => {
  const region = historyRegion(focus);

  return {
    available: history !== null && !history.pending() && (redo ? history.redoAvailable(region) : history.available(region)),
    label: history ? (redo ? history.redoLabel(region) : history.undoLabel(region)) : redo ? copy.redo : copy.todoUndo,
    run: () => { void (redo ? history!.redo(region) : history!.undo(region)); },
  };
};

export const TEXT_FIELD = "input,textarea,[contenteditable]:not([contenteditable=false]),.xterm,[role=textbox]";

/** The Project menu's rows: Undo and Redo ("edit"), then the creating ("create") and navigating ("navigate") actions the focus can reach. */
export const projectMenuItems = (focus: Element | null, connected: boolean, history: TodoUndo | null): MenuItem[] => {
  const actions = captureActions(focus);

  return [
    ...(!focus?.closest(TEXT_FIELD) ? ["⌘Z", "⇧⌘Z"].map(keys => {
      const undo = undoAction(history, keys === "⇧⌘Z", focus);

      return { id: `action:chord:${keys}`, label: undo.label, shortcut: keys, group: "edit" as const, enabled: connected && undo.available };
    }) : []),
    ...[
      ...(["agent.new", "agent.new-with-prompt", "workstream.new", "mode.new", "terminal.new", "todo.capture", "attention.jump"] as const).map(name => CHORDS[name]),
      LEADER["leader.changes"],
      LEADER["leader.project"],
      CHORDS["project.choose-folder"],
    ].map((row, index): MenuItem => {
      const action = actions.find(action => action.name === row.name && action.available());

      return {
        id: action?.value ?? `action:${"press" in row ? "leader" : "chord"}:${row.keys}`,
        label: copy.projectMenuLabel(row.name, row.what),
        shortcut: "press" in row ? leaderKeys(row) : action?.press ? shortcutLabel(action.press) : row.keys,
        group: index < 6 ? "create" : "navigate",
        enabled: connected && action !== undefined,
      };
    }),
  ];
};

/** The writer of the Project menu: one write at a time, and when the menu changes during a write the next write sends the latest. */
export const createMenuWriter = (app: Pick<App, "selectProjectMenu">, fail: (message: string) => void) => {
  let writing = false;
  let written: unknown;

  return async (latest: () => { path: string | null; items: MenuItem[] }) => {
    if (writing) return;
    writing = true;

    try {
      while (written !== latest()) {
        const next = latest();
        written = next;
        await app.selectProjectMenu(next.path, next.items);
      }
    } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
    finally { writing = false; }
  };
};
