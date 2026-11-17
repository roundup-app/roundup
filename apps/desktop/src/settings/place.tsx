import type { JSX } from "@solidjs/web";
import { children, flush, onCleanup, type ChildrenReturn } from "solid-js";
import { copy } from "./copy";
import type { Entry } from "./entries";

/** PL2: a Settings page as a link names it, and the value of its tab in App Settings. */
export const SETTINGS_PAGES = {
  agents: copy.settingsAgents,
  terminal: copy.settingsTerminal,
  editor: copy.settingsEditor,
  shortcuts: copy.settingsShortcuts,
  appearance: copy.settingsAppearance,
  alerts: copy.settingsAlerts,
  pads: copy.settingsPads,
  machines: copy.settingsMachines,
  updates: copy.settingsUpdates,
} as const;

/** What App Settings hands over so a link can move it. */
type Live = { entries: () => Entry[]; setQuery: (query: string) => void; setSection: (section: string) => void; show: () => void };

let live: Live | undefined;

/** The rendered control of each entry id, until it unmounts. */
const marks = new Map<string, ChildrenReturn>();

export const registerSettingsPlace = (next: Live) => {
  live = next;

  return () => { if (live === next) live = undefined; };
};

/** PL2: each entry's control is known by its id, in a page and in a search result alike; the control stays the element it was, so it keeps its place among its siblings. */
export const markControls = <K extends string>(renders: Record<K, () => JSX.Element>) => {
  // SAFETY: the map keeps every key and returns one render per key.
  return Object.fromEntries(Object.entries<() => JSX.Element>(renders).map(([id, render]) => [id, () => {
    const control = render();
    const nodes = children(() => control);

    marks.set(id, nodes);
    onCleanup(() => { if (marks.get(id) === nodes) marks.delete(id); });

    return control;
  }])) as Record<K, () => JSX.Element>;
};

/** Deferred controls mount after their page, so the focus waits for the control a short while. */
const focusControl = (id: string) => {
  const reach = (target: HTMLElement) => { target.focus(); target.scrollIntoView({ block: "nearest" }); };

  const find = () => marks.get(id)?.toArray().map(node => node instanceof Element ? node.querySelector<HTMLElement>("input, button, [role=combobox], [role=radio], [role=switch], textarea") : null).find(target => target !== null);
  const now = find();

  if (now) return reach(now);

  const watch = new MutationObserver(() => {
    const target = find();

    if (!target) return;
    watch.disconnect();
    reach(target);
  });

  watch.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => watch.disconnect(), 2000);
};

/** PL2: open `page` and focus the control whose entry id is `control`, changing no value; the line saying why nothing moved, or `null`. */
export const goToSetting = (page: string, control: string | null): string | null => {
  const target = Object.entries(SETTINGS_PAGES).find(([name]) => name === page)?.[1];

  if (!live || !target) return copy.noSettingsPage(page);

  if (control !== null && !live.entries().some(entry => entry.id === control && entry.page === target)) return copy.noSettingsControl(control, target);

  live.setQuery("");
  live.setSection(target);
  live.show();

  if (control !== null) {
    flush();
    // The view moves focus into itself once it has mounted; the control is the later choice.
    setTimeout(() => focusControl(control));
  }

  return null;
};
