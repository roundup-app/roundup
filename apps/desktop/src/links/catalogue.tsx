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
import type { ChordName } from "../keys/chords";
import { IconButton } from "../ui/IconButton";
import { copy } from "./copy";

export type Env = { editor: () => void; terminal: () => void; open: (url: string) => void };

const icon = { props: z.object({ tooltip: z.string(), url: z.string().optional() }) };

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
    more: { props: z.object({ count: z.number(), open: z.boolean() }) },
  },
  actions: {},
});

/** The most icons shown inline (LH9). */
const SHOWN = 6;

/** The header's spec: the App's own two icons, then one element per entry of the set. */
export const specOf = (set: LinkSet | undefined): Spec => {
  const entries = set?.entries ?? [];

  const elements: Spec["elements"] = {
    header: { type: "links", props: {}, children: ["editor", "terminal", ...entries.map((_, index) => `link${index}`)] },
    editor: { type: "editor", props: { tooltip: copy.editor }, children: [] },
    terminal: { type: "terminal", props: { tooltip: copy.terminal }, children: [] },
  };

  entries.forEach((entry, index) => { elements[`link${index}`] = { type: entry.kind, props: { url: entry.url, tooltip: entry.tooltip }, children: [] }; });

  return { root: "header", elements };
};

/** LH9: the root's first six children, then a `more` count of the rest; all of them once the count is open. */
const cut = (spec: Spec, open: boolean): Spec => {
  const head = spec.elements[spec.root];
  const ids = head?.children ?? [];

  if (!head || ids.length <= SHOWN) return spec;

  const more = { type: "more", props: { count: ids.length - SHOWN, open }, children: [] };

  return { ...spec, elements: { ...spec.elements, [spec.root]: { ...head, children: [...(open ? ids : ids.slice(0, SHOWN)), "more"] }, more } };
};

/** LH8, LH9: the icons of a spec through `@json-render/solid`, six inline and a `+N` count that reveals the rest. */
export const LinksView = (props: { spec: Spec; env: Env }) => {
  const [open, setOpen] = createSignal(false);

  type Icon = Component<{ size?: number; "aria-hidden"?: "true" }>;

  type Ctx = { props: { tooltip: string; url?: string | undefined } };

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
      more: ctx => <IconButton class="links-count" aria-label={ctx.props.open ? copy.lessName : copy.moreName(ctx.props.count)} aria-expanded={ctx.props.open ? "true" : "false"} onClick={() => setOpen(now => !now)}>{ctx.props.open ? copy.less : `+${ctx.props.count}`}</IconButton>,
    },
  });

  return <JSONUIProvider registry={registry}><Renderer spec={cut(props.spec, open())} registry={registry} /></JSONUIProvider>;
};
