import Code from "@lucide/solid/icons/code";
import GitPullRequest from "@lucide/solid/icons/git-pull-request";
import Link from "@lucide/solid/icons/link";
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
import { IconButton } from "../ui/IconButton";
import { copy } from "./copy";

export type Env = { editor: () => void; terminal: () => void; open: (url: string) => void };

const icon = { props: z.object({ tooltip: z.string(), url: z.string().optional() }), description: "An icon button" };

/** LH2, LH8: the fixed catalogue; a spec element of any other type renders nothing. */
const catalog = defineCatalog(schema, {
  components: {
    Links: { props: z.object({}), description: "The header row" },
    Editor: icon,
    Terminal: icon,
    pr: icon,
    tracker: icon,
    "dev-server": icon,
    asked: icon,
    More: { props: z.object({ count: z.number(), open: z.boolean() }), description: "The +N count of the icons past the sixth" },
  },
  actions: {},
});

/** The most icons shown inline (LH9). */
const SHOWN = 6;

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

/** LH9: the root's first six children, then a `More` count of the rest; all of them once the count is open. */
const cut = (spec: Spec, open: boolean): Spec => {
  const root = spec.elements[spec.root];
  const children = root?.children ?? [];

  if (!root || children.length <= SHOWN) return spec;

  const more = { type: "More", props: { count: children.length - SHOWN, open }, children: [] };

  return { ...spec, elements: { ...spec.elements, [spec.root]: { ...root, children: [...(open ? children : children.slice(0, SHOWN)), "more"] }, more } };
};

/** LH8, LH9: the icons of a spec through `@json-render/solid`, six inline and a `+N` count that reveals the rest. */
export const LinksView = (props: { spec: Spec; env: Env }) => {
  const [open, setOpen] = createSignal(false);

  type Icon = Component<{ size?: number; "aria-hidden"?: "true" }>;

  type Ctx = { props: { tooltip: string; url?: string | undefined } };

  const iconOf = (Icon: Icon, type: string, run: (env: Env, url: string) => void) => (ctx: Ctx) =>
    <IconButton aria-label={ctx.props.tooltip} data-link={type} action={type === "Terminal" ? "terminal.new" : undefined} onClick={() => run(props.env, ctx.props.url ?? "")}><Icon size={16} aria-hidden="true" /></IconButton>;

  const { registry } = defineRegistry(catalog, {
    components: {
      Links: ctx => <>{ctx.children}</>,
      Editor: iconOf(Code, "Editor", env => env.editor()),
      Terminal: iconOf(SquareTerminal, "Terminal", env => env.terminal()),
      pr: iconOf(GitPullRequest, "pr", (env, url) => env.open(url)),
      tracker: iconOf(Ticket, "tracker", (env, url) => env.open(url)),
      "dev-server": iconOf(Server, "dev-server", (env, url) => env.open(url)),
      asked: iconOf(Link, "asked", (env, url) => env.open(url)),
      More: ctx => <IconButton class="links-count" aria-label={ctx.props.open ? copy.lessName : copy.moreName(ctx.props.count)} aria-expanded={ctx.props.open ? "true" : "false"} onClick={() => setOpen(now => !now)}>{ctx.props.open ? "−" : `+${ctx.props.count}`}</IconButton>,
    },
  });

  return <JSONUIProvider registry={registry}><Renderer spec={cut(props.spec, open())} registry={registry} /></JSONUIProvider>;
};
