import type { Accessor } from "solid-js";
import type { DaemonExit } from "../app/seam";
import { render } from "@solidjs/testing-library";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Message } from "@contracts/message/Message";
import { Rail } from "../rail/Rail";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { fakeEmulators } from "../terminal/paneHarness";
import { Pane } from "../terminal/Pane";
import { createFakeApp } from "./fakeApp";
import type { FakeApp } from "./fakeApp";
import { info, NOW, USER } from "./nodes";
import { Pads } from "../pads/Pads";
import { Todos } from "../todos/Todos";

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

type Options = { messages?: Message[]; reducedMotion?: boolean; failure?: Error; select?: string | null; daemonExit?: Accessor<DaemonExit | null>; fold?: "closed"; prepare?: (app: FakeApp) => void };

/** The Rail, the Pane and the Shelf in one `.window`, as the App lays them out, over a fake Daemon. */
export const mountCentre = async (tree: RailNode[], options: Options = {}) => {
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
  app.handlers["pad.list"] = () => [{ incarnation: "fixture-1", name: "notes", owner: USER, text: "", updated_at: 0, revision: 1, home }];

  options.prepare?.(app);

  const reduced = options.reducedMotion ?? false;
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => reduced, () => NOW, options.daemonExit);
  const { factory, made } = fakeEmulators();

  const view = render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <div class="window">
        <section class="rail"><Rail /></section>
        <section class="centre">
          <div class="centre-stack">
            <Pane createEmulator={factory} />
          </div>
        </section>
        <section class="shelf"><Todos /><Pads /></section>
      </div>
    </ConnectedProjectContext.Provider>
  ));

  await connected.rail.settled();

  const opened = options.select === undefined ? tree.find((node) => node.kind === "workstream" || node.parent === null)?.id : options.select;

  if (opened !== undefined && opened !== null) connected.rail.select(opened);

  return { app, connected, emulators: made, ...view };
};
