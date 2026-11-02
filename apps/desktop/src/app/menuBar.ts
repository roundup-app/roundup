import { menuBarCopy } from "./copy";
import type * as Solid from "solid-js";
import type { ConnectedProject } from "../state/connectedProject";
import type { OpenTab } from "../state/projects";
import type { App, MenuBar } from "./seam";
import type { Kind } from "@contracts/Kind";

const glyph: Record<Kind, string> = { error: "⊗", "needs-you": "◉", blocked: "⊖", working: "◔", idle: "○", done: "✓" };

const literal = (text: string) => text.replace(/[\r\n\u2028\u2029]+/g, " ");

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const short = (text: string) => {
  const parts = [...graphemes.segment(literal(text))].map(part => part.segment);

  return parts.length > 24 ? parts.slice(0, 23).join("") + "…" : parts.join("");
};

/** U5502: only the connected App owns membership; the native shell presents literal rows. */
export const watchMenuBar = (options: {
  solid: Pick<typeof Solid, "createEffect" | "onCleanup">;
  app: App;
  tabs: () => OpenTab[];
  connection: (path: string) => ConnectedProject | undefined;
  select: (path: string) => void;
  missing: string;
  fail: (message: string | null) => void;
}) => {
  const { createEffect, onCleanup } = options.solid;
  const waitingSince = new Map<string, { kind: Kind; attempt: string | null; since: number }>();
  createEffect(() => {
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

        return [{ path: tab.project.path, agent: node.id, waiting, since,
          label: menuBarCopy.row(glyph[status.kind], literal(node.name), tabs.length > 1 ? literal(tab.project.name) : null, short(status.label)) }];
      });
    }).sort((a, b) => Number(b.waiting) - Number(a.waiting)
      || (a.waiting ? a.since - b.since : b.since - a.since)
      || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
      || (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0));

    for (const key of waitingSince.keys()) {
      if (!current.has(key)) waitingSince.delete(key);
    }

    const menu: MenuBar = { mark: rows.some(row => row.waiting) ? "waiting" : rows.length ? "ready" : "empty", entries: [] };
    let group: boolean | undefined;

    for (const row of rows.slice(0, 7)) {
      if (group !== row.waiting) menu.entries.push({ label: row.waiting ? menuBarCopy.waiting : menuBarCopy.ready, action: null });
      group = row.waiting;
      menu.entries.push({ label: row.label, since: row.since, action: { kind: "agent", path: row.path, agent: row.agent } });
    }

    if (rows.length === 0) menu.entries.push({ label: menuBarCopy.empty, action: null });

    if (rows.length > 7) menu.entries.push({ label: menuBarCopy.more(rows.length - 7), action: { kind: "open" } });
    menu.entries.push({ label: menuBarCopy.open, action: { kind: "open" } });
    const failure = tabs.map(tab => options.connection(tab.project.path)?.unseen.publicationFailure()).find(Boolean) ?? null;

    void options.app.setMenuBar(menu).then(() => options.fail(failure), error => options.fail(String(error)));
  });
  let ended = false;
  let stop: (() => void) | undefined;
  void options.app.onMenuBarAction(action => {
    if (action.kind !== "agent") return;
    const rail = options.connection(action.path)?.rail;

    if (!options.tabs().some(tab => tab.project.path === action.path) || !rail?.nodes.some(node => node.id === action.agent)) return options.fail(options.missing);
    options.fail(null);
    options.select(action.path);
    rail.select(action.agent);
  }).then(unsubscribe => { if (ended) unsubscribe(); else stop = unsubscribe; });
  onCleanup(() => { ended = true; stop?.(); });
};
