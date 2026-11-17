import Code from "@lucide/solid/icons/code";
import GitPullRequest from "@lucide/solid/icons/git-pull-request";
import Link from "@lucide/solid/icons/link";
import Server from "@lucide/solid/icons/server";
import SquareTerminal from "@lucide/solid/icons/square-terminal";
import Ticket from "@lucide/solid/icons/ticket";
import { createSignal, For, Show } from "solid-js";
import type { Spec } from "@json-render/core";
import type { LinkSet } from "@contracts/links/LinkSet";
import { IconButton } from "../ui/IconButton";
import { copy } from "./copy";

/** LH8: the fixed catalogue. A spec element names one of these types; any other type renders nothing. */
const ICONS = { Editor: Code, Terminal: SquareTerminal, pr: GitPullRequest, tracker: Ticket, "dev-server": Server, asked: Link } as const;

type Type = keyof typeof ICONS;

export type Env = { editor: () => void; terminal: () => void; open: (url: string) => void };

type Item = { id: string; type: Type; url: string; tooltip: string };

/** The most icons shown inline (LH9). */
const SHOWN = 6;


const known = (type: string): type is Type => Object.hasOwn(ICONS, type);

/** The header's spec: the App's own two icons, then one element per entry of the set. */
export const specOf = (set: LinkSet | undefined): Spec => {
  const entries = set?.entries ?? [];

  const elements: Spec["elements"] = {
    header: { type: "Links", props: {}, children: ["editor", "terminal", ...entries.map((_, index) => `link${index}`)] },
    editor: { type: "Editor", props: { tooltip: copy.editor }, children: [] },
    terminal: { type: "Terminal", props: { tooltip: copy.terminal }, children: [] },
  };

  entries.forEach((entry, index) => { elements[`link${index}`] = { type: entry.kind, props: { url: entry.url, tooltip: entry.tooltip }, children: [] }; });

  return { root: "header", elements };
};


const itemsOf = (spec: Spec): Item[] => (spec.elements[spec.root]?.children ?? []).flatMap(id => {
  const element = spec.elements[id];

  if (!element || !known(element.type)) return [];
  // SAFETY: the props of a catalogue type hold only the optional strings `url` and `tooltip`, as `specOf` writes them.
  const { url, tooltip } = element.props as { url?: string; tooltip?: string };

  return [{ id, type: element.type, url: url ?? "", tooltip: tooltip ?? "" }];
});

/** LH8, LH9: the icons of a spec, six inline and a `+N` count that reveals the rest; an element outside the catalogue draws nothing. */
export const LinksView = (props: { spec: Spec; env: Env }) => {
  const [all, setAll] = createSignal(false);
  const items = () => itemsOf(props.spec);
  const rest = () => Math.max(0, items().length - SHOWN);
  const shown = () => all() ? items() : items().slice(0, SHOWN);

  const run = (item: Item) => {
    if (item.type === "Editor") props.env.editor();
    else if (item.type === "Terminal") props.env.terminal();
    else props.env.open(item.url);
  };

  return (
    <>
      <For each={shown()}>{item => {
        const Icon = ICONS[item.type];

        return <IconButton aria-label={item.tooltip} data-link={item.type} action={item.type === "Terminal" ? "terminal.new" : undefined} onClick={() => run(item)}><Icon size={16} aria-hidden="true" /></IconButton>;
      }}</For>
      <Show when={rest() > 0}>
        <IconButton class="links-count" aria-label={all() ? copy.lessName : copy.moreName(rest())} aria-expanded={all() ? "true" : "false"} onClick={() => setAll(now => !now)}>{all() ? "−" : `+${rest()}`}</IconButton>
      </Show>
    </>
  );
};
