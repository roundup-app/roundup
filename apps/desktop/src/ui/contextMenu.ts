import type { RpcMethods } from "@contracts/methods";
import type { RailNode } from "@contracts/agent/RailNode";
import { copy } from "../copy";
import type { App, AppSeam, MenuItem } from "../app/seam";

/** U2694a: one item of a menu model. `run` stays in the webview; only the rest crosses to the host. */
export type MenuEntry = {
  id: string;
  label: string;
  /** The chord as `keys/chords.ts` shows it: label text, never an accelerator. */
  shortcut?: string | undefined;
  enabled?: boolean;
  run?: () => void | Promise<void>;
  children?: MenuEntry[];
};

const wire = (entry: MenuEntry): MenuItem => {
  const item: MenuItem = { id: entry.id, label: entry.label, enabled: entry.enabled ?? true };

  if (entry.shortcut !== undefined) item.shortcut = entry.shortcut;

  if (entry.children !== undefined) item.children = entry.children.map(wire);

  return item;
};

const find = (entries: MenuEntry[], id: string): MenuEntry | undefined => {
  for (const entry of entries) {
    const found = entry.id === id ? entry : entry.children && find(entry.children, id);

    if (found) return found;
  }

  return undefined;
};

/** U2694a: the only caller of `showContextMenu`. Pops the system menu of `model` at `x`, `y`, then runs the chosen item; closing with no choice runs nothing. */
export const contextMenu = async (app: Pick<App, "showContextMenu">, model: MenuEntry[], x: number, y: number): Promise<void> => {
  const chosen = await app.showContextMenu(model.map(wire), x, y);
  const entry = chosen === null ? undefined : find(model, chosen);

  if (entry && entry.enabled !== false) await entry.run?.();
};

/** LK1: the kinds a link names. */
export type LinkKind = "pad" | "todo" | "agent" | "workstream" | "terminal";

/** LK1: `roundup://<kind>/<id>?project=<key>`; the key is the Daemon's, read once per seam. */
const keys = new WeakMap<AppSeam, Promise<string>>();

const linkOf = async (app: AppSeam, kind: LinkKind, id: string | number): Promise<string> => {
  let key = keys.get(app);

  if (!key) {
    key = app.rpc("daemon.ping", null).then((ping) => ping.projectKey);
    key.catch(() => keys.delete(app));
    keys.set(app, key);
  }

  return copy.linkUrl(kind, encodeURIComponent(String(id)), encodeURIComponent(await key));
};

/** U2694c: Copy Link and Send to Agent ▸ for one object; `agents` are the Project's Agents in Rail order, `fail` shows U80's line. */
export const linkEntries = (
  app: AppSeam,
  kind: LinkKind,
  id: string | number,
  agents: RailNode[],
  running: (node: RailNode) => boolean,
  fail: (message: string) => void,
): MenuEntry[] => {
  const attempt = async (call: () => Promise<void>) => {
    try {
      await call();
    } catch (error) {
      if (error instanceof Error) fail(error.message);
      else throw error;
    }
  };

  return [
    {
      id: "send",
      label: copy.sendToAgentMenu,
      children: agents.map((agent): MenuEntry => ({
        id: `send:${agent.id}`,
        label: agent.name,
        enabled: running(agent),
        run: () => attempt(async () => {
          const link = await linkOf(app, kind, id);
          const params: RpcMethods["message.send"]["params"] = { to: agent.id, kind: "note", body: copy.linkNote(link), replyTo: null };

          await app.rpc("message.send", params);
        }),
      })),
    },
    { id: "copy-link", label: copy.copyLink, run: () => attempt(async () => { await navigator.clipboard.writeText(await linkOf(app, kind, id)); }) },
  ];
};

/** U421, U2694e: a right-button press that moves this far (CSS pixels) is a Pull; short of it, a click. */
export const PULL_DISTANCE = 8;

/**
 * U2694e: a right-click is a click. Called from an object's `contextmenu`: the browser's menu never shows, and `open` runs at the release of a press that never reached `PULL_DISTANCE`.
 * A Pull stops its own release (U421), so a drag past the distance opens nothing.
 */
export const openOnRelease = (press: MouseEvent, open: (x: number, y: number) => void): void => {
  press.preventDefault();

  if ((press.buttons & 2) === 0) {
    open(press.clientX, press.clientY);

    return;
  }

  const from = { x: press.clientX, y: press.clientY };

  const stop = () => {
    document.removeEventListener("pointerup", release);
    window.removeEventListener("pointerdown", stop, true);
  };

  const release = (event: PointerEvent) => {
    stop();

    if (Math.hypot(event.clientX - from.x, event.clientY - from.y) < PULL_DISTANCE) open(event.clientX, event.clientY);
  };

  document.addEventListener("pointerup", release);
  window.addEventListener("pointerdown", stop, true);
};
