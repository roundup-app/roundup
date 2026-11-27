import Code from "@lucide/solid/icons/code";
import GitPullRequest from "@lucide/solid/icons/git-pull-request";
import Link from "@lucide/solid/icons/link";
import NotebookText from "@lucide/solid/icons/notebook-text";
import FileText from "@lucide/solid/icons/file-text";
import Server from "@lucide/solid/icons/server";
import SquareTerminal from "@lucide/solid/icons/square-terminal";
import Ticket from "@lucide/solid/icons/ticket";
import { createSignal, type Component } from "solid-js";
import { defineCatalog, type Spec } from "@json-render/core";
// @json-render/solid 0.23.1 targets Solid 1 and has no Solid 2 release; the App runs Solid 2. patches/@json-render__solid@0.23.1.patch
// ports its dist to Solid 2 (owner, 2026-11-17, #7370) until upstream supports it.
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/solid";
import { schema } from "@json-render/solid/schema";
import { z } from "zod";
import type { LinkSet } from "@contracts/links/LinkSet";
import type { MadeItem } from "@contracts/links/MadeItem";
import type { ChordName } from "../keys/chords";
import { IconButton } from "../ui/IconButton";
import { Popover } from "../ui/Popover";
import { copy } from "./copy";

export type Env = { editor: () => void; terminal: () => void; open: (url: string) => void; made: (item: Pick<MadeItem, "kind" | "id">) => void };

const icon = { props: z.object({ tooltip: z.string(), url: z.string().optional() }) };

const madeIcon = { props: z.object({ tooltip: z.string(), id: z.string(), first: z.boolean() }) };

/** LH2, LH8: the fixed catalogue; a spec element of any other type renders nothing. No model reads it, so it carries no descriptions. */
const catalog = defineCatalog(schema, {
  components: {
    links: { props: z.object({}) },
    editor: icon,
    terminal: icon,
    pr: icon,
    tracker: icon,
    "dev-server": icon,
    asked: icon,
    pad: madeIcon,
    file: madeIcon,
    more: { props: z.object({ count: z.number() }) },
  },
  actions: {},
});

/** The most icons shown inline (LH9). */
const SHOWN = 6;

/** The header's spec: the App's own two icons, then one element per entry of the set, then one per made item (LH21). */
export const specOf = (set: LinkSet | undefined, made: readonly MadeItem[] = []): Spec => {
  const entries = set?.entries ?? [];

  const elements: Spec["elements"] = {
    header: { type: "links", props: {}, children: ["editor", "terminal", ...entries.map((_, index) => `link${index}`), ...made.map((_, index) => `made${index}`)] },
    editor: { type: "editor", props: { tooltip: copy.editor }, children: [] },
    terminal: { type: "terminal", props: { tooltip: copy.terminal }, children: [] },
  };

  entries.forEach((entry, index) => { elements[`link${index}`] = { type: entry.kind, props: { url: entry.url, tooltip: entry.tooltip }, children: [] }; });

  made.forEach((item, index) => { elements[`made${index}`] = { type: item.kind, props: { id: item.id, tooltip: copy.madeTooltip(item), first: index === 0 }, children: [] }; });

  return { root: "header", elements };
};

/** LH9: the root's first six children, then a `more` count whose popover holds the rest once open. */
const cut = (spec: Spec, shown: number): Spec => {
  const head = spec.elements[spec.root];
  const ids = head?.children ?? [];
  const inline = Math.min(SHOWN, shown);

  if (!head || ids.length <= inline) return spec;

  // LH13: the revealed rest are the count's children, drawn in a popover and never a second row of the header.
  const more = { type: "more", props: { count: ids.length - inline }, children: ids.slice(inline) };

  return { ...spec, elements: { ...spec.elements, [spec.root]: { ...head, children: [...ids.slice(0, inline), "more"] }, more } };
};

/** LH13: how many icons fit inline in a pane of this width, the handle's and the count's slots kept; at most six (LH9). */
const SLOT = 28;

const GAP = 4;

const PAD = 16;

export const inlineFor = (width: number, total: number): number => {
  const slots = Math.floor((width - PAD + GAP) / (SLOT + GAP)) - 1;

  return total <= Math.min(SHOWN, slots) ? total : Math.max(0, Math.min(SHOWN, slots - 1));
};

/** LH8, LH9: the icons of a spec through `@json-render/solid`, six inline and a `+N` count that reveals the rest. */
export const LinksView = (props: { spec: Spec; env: Env; shown?: number }) => {
  const [open, setOpen] = createSignal(false);
  const [trigger, setTrigger] = createSignal<HTMLElement>();
  const [content, setContent] = createSignal<HTMLElement>();
  // The ref runs before the trigger is in the DOM, so the header is found when the anchor is read.
  const headerBox = { getBoundingClientRect: () => (trigger()?.closest(".links-header") ?? trigger())?.getBoundingClientRect() ?? new DOMRect() };

  type Icon = Component<{ size?: number; "aria-hidden"?: "true" }>;

  type Ctx = { props: { tooltip: string; url?: string | undefined } };

  type MadeCtx = { props: { tooltip: string; id: string; first: boolean } };

  // LH21: a made icon sits after the links, set off by a space step on the first, so the Agent's links and its work read apart.
  const madeOf = (Icon: Icon, kind: MadeItem["kind"]) => (ctx: MadeCtx) =>
    <IconButton class="links-made" data-first={ctx.props.first ? "" : undefined} aria-label={ctx.props.tooltip} onClick={() => props.env.made({ kind, id: ctx.props.id })}><Icon size={16} aria-hidden="true" /></IconButton>;

  const iconOf = (Icon: Icon, run: (env: Env, url: string) => void, action?: ChordName) => (ctx: Ctx) =>
    <IconButton aria-label={ctx.props.tooltip} action={action} onClick={() => run(props.env, ctx.props.url ?? "")}><Icon size={16} aria-hidden="true" /></IconButton>;

  const { registry } = defineRegistry(catalog, {
    components: {
      links: ctx => <>{ctx.children}</>,
      editor: iconOf(Code, env => env.editor()),
      terminal: iconOf(SquareTerminal, env => env.terminal(), "terminal.new"),
      pr: iconOf(GitPullRequest, (env, url) => env.open(url)),
      tracker: iconOf(Ticket, (env, url) => env.open(url)),
      "dev-server": iconOf(Server, (env, url) => env.open(url)),
      asked: iconOf(Link, (env, url) => env.open(url)),
      pad: madeOf(NotebookText, "pad"),
      file: madeOf(FileText, "file"),
      more: ctx => (
        <Popover.Root open={open()} onOpenChange={({ open: next }) => setOpen(next)} initialFocusEl={() => content()?.querySelector("button")} finalFocusEl={() => trigger()}>
          <Popover.Trigger render={trigger => (
            <IconButton {...trigger} ref={setTrigger} class="links-count" aria-label={open() ? copy.lessName : copy.moreName(ctx.props.count)}>{open() ? copy.less : `+${ctx.props.count}`}</IconButton>
          )} />
          <Popover.Content ref={setContent} anchor={headerBox} side="left" align="center" sideOffset={0} class="links-popover" aria-label={copy.moreName(ctx.props.count)}>{ctx.children}</Popover.Content>
        </Popover.Root>
      ),
    },
  });

  return <JSONUIProvider registry={registry}><Renderer spec={cut(props.spec, props.shown ?? SHOWN)} registry={registry} /></JSONUIProvider>;
};
