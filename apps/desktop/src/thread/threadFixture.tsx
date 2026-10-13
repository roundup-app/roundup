import type { Accessor } from "solid-js";
import type { DaemonExit } from "../app/seam";
import { render } from "@solidjs/testing-library";
import { vi } from "vitest";
import type { Event as DaemonEvent } from "@contracts/Event";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Message } from "@contracts/message/Message";
import { Jump } from "../rail/Jump";
import { Rail } from "../rail/Rail";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { fakeEmulators } from "../terminal/paneHarness";
import { Pane } from "../terminal/Pane";
import { createFakeApp } from "../testing/fakeApp";
import type { FakeApp } from "../testing/fakeApp";
import { door, event, info, NOW, USER } from "../testing/nodes";
import { Pads } from "../pads/Pads";
import { Todos } from "../todos/Todos";
import { trackSelections } from "./emulators";
import { Thread } from "./Thread";

export const message = (id: number, over: Partial<Message> = {}): Message => ({
  id,
  from: { kind: "agent", id: "a", parent: null },
  to: "b",
  kind: "note",
  body: `body ${id}`,
  replyTo: null,
  status: "delivered",
  reason: null,
  passedFrom: null,
  at: NOW,
  ...over,
});

export const sent = (data: Message): DaemonEvent => event({ name: "message.sent", data });

type Options = { messages?: Message[]; reducedMotion?: boolean; failure?: Error; select?: string | null; daemonExit?: Accessor<DaemonExit | null>; fold?: "closed"; prepare?: (app: FakeApp) => void };

/** The Rail, the Pane, the Thread and the Shelf in one `.window`, as the App lays them out, over a fake Daemon. */
export const mountThread = async (tree: RailNode[], options: Options = {}) => {
  const app = createFakeApp();

  app.handlers["rail.tree"] = () => tree;
  app.handlers["terminal.list"] = () => tree.flatMap((node) => (node.terminal_id ? [info(node.terminal_id)] : []));
  app.handlers["terminal.write"] = () => null;
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
  app.handlers["message.list"] = () => options.messages ?? [];
  app.handlers["message.send"] = (params) => message(99, { from: USER, to: params.to, body: params.body });
  app.handlers["attachment.save"] = (params) => ({ path: `/saved/${params.name}` });
  app.handlers["takeover.begin"] = () => null;
  app.handlers["takeover.end"] = () => null;
  /** U347: a selected Workstream shows only its own, so the fixture's items sit in the first one. */
  const home = tree.find((node) => node.kind === "workstream")?.id ?? null;
  app.handlers["todo.list"] = () => [{ id: 1, title: "todo 1", body: "", done: false, blockers: [], blocked: false, created_at: 0, creator: USER, home }];
  app.handlers["pad.list"] = () => [{ name: "notes", owner: USER, text: "", updated_at: 0, home }];

  options.prepare?.(app);

  const reduced = options.reducedMotion ?? false;
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => reduced, () => NOW, options.daemonExit);
  const { factory, made } = fakeEmulators();
  const selections = trackSelections(factory);

  const view = render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Jump onFailure={() => {}} />
      <div class="window">
        <section class="rail"><Rail /></section>
        <section class="centre">
          <div class="centre-stack">
            <Pane createEmulator={selections.create} />
            <Thread selectionOf={selections.selectionOf} />
          </div>
        </section>
        <section class="shelf"><Todos /><Pads /></section>
      </div>
    </ConnectedProjectContext.Provider>
  ));

  await connected.rail.settled();

  // U145: the Thread shows only under a Workstream, so these tests open the first one unless `select` says otherwise.
  const opened = options.select === undefined ? tree.find((node) => node.kind === "workstream" || node.parent === null)?.id : options.select;

  if (opened !== undefined && opened !== null) connected.rail.select(opened);

  // U422: every Message is under `All messages`, so the tests of the Messages' own drawing read it shown.
  if (options.fold !== "closed" && view.container.querySelector("[aria-label='More']")) await chooseFromMenu("All messages", view.container);

  return { app, connected, emulators: made, ...view };
};

/** The product of `opacity` along `element` and its ancestors: the effective opacity a person sees. */
export const effectiveOpacity = (element: Element): number => {
  let product = 1;

  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    const own = getComputedStyle(at).opacity;

    product *= own === "" ? 1 : Number(own);
  }

  return product;
};

export const threadInput = (): HTMLTextAreaElement => {
  const found = document.querySelector<HTMLTextAreaElement>("[data-thread-input]");

  if (!found) throw new Error("no Thread input");

  return found;
};

const REPORT_DOOR = { kind: "agent", id: "r1", parent: null } as const;

/** U197: the Messages of the user's report on #729: a Door's note, its `question` to `you` with `**` in the body, and the user's note. */
export const reportFixture = () => ({
  tree: [
    door("r1", "working", "working", {
      name: "workstream-1",
      work: { kind: "work", ask: "Give a short tour of the repo and say where the build starts, which tests run on a push and what a change must pass before it merges", limits: ["touch main", "skip tests", "edit contracts"] },
    }),
  ],
  messages: [
    message(1, { from: REPORT_DOOR, to: "you", kind: "note", body: "On it. Found it: the build starts in justfile." }),
    message(2, { from: REPORT_DOOR, to: "you", kind: "question", body: "My guess is that **just check** is the gate. Should I describe it?" }),
    message(3, { from: USER, to: "r1", kind: "note", body: "start with the tests", replyTo: 2 }),
  ],
});

/** B33: an entry as a pushed body writes it. */
export const text = (e: { name: string; kind: string; last: string; todos: number; pads: string[] }) =>
  [`${e.name} is ${e.kind}`, `  last: ${e.last}`, `  open todos: ${e.todos}`, ...(e.pads.length > 0 ? [`  pads: ${e.pads.join(", ")}`] : [])].join("\n");

/** U422: chooses `label` in the Thread's `⋯` menu, once the menu holds it. */
export const chooseFromMenu = async (label: string, within: ParentNode = document): Promise<void> => {
  await vi.waitFor(() => {
    const more = within.querySelector<HTMLButtonElement>("[aria-label='More']");

    if (!more) throw new Error("no ⋯ button");

    if (more.getAttribute("aria-expanded") !== "true") more.click();

    const item = [...(more.parentElement ?? document).querySelectorAll<HTMLButtonElement>("[role=menuitem]")].find((each) => each.textContent === label);

    if (!item) {
      more.click();
      throw new Error(`no menu item ${label}`);
    }

    item.click();
  });
};
