import { render } from "@solidjs/testing-library";
import type { Message } from "@contracts/message/Message";
import type { RailNode } from "@contracts/agent/RailNode";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { createFakeApp } from "../testing/fakeApp";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { event } from "../testing/nodes";
import { fakeEmulators } from "./paneHarness";
import { Pane } from "./Pane";

/** A Message to `to`, as the Daemon sends it. */
export const note = (id: number, body: string, over: Partial<Message> = {}): Message => ({
  id, from: { kind: "user", id: "user", parent: null }, to: "a", kind: "note", body, replyTo: null, status: "pending", reason: null, at: id, ...over,
});

/** A Pane of an open Project whose Daemon lists `messages`; `reduced` is `prefers-reduced-motion`. */
export const mountNotes = async (tree: RailNode[], terminals: TerminalInfo[], messages: Message[] = [], reduced = false) => {
  const app = createFakeApp();

  app.handlers["rail.tree"] = () => tree;
  app.handlers["terminal.list"] = () => terminals;
  app.handlers["terminal.write"] = () => null;
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
  app.handlers["message.list"] = (params) => messages.filter((each) => each.to === params.to);
  app.handlers["takeover.begin"] = () => null;
  app.handlers["takeover.end"] = () => null;
  app.handlers["agent.interrupt"] = () => null;

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => reduced, () => 0);
  const { factory, made } = fakeEmulators();

  const { container } = render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Pane createEmulator={factory} />
    </ConnectedProjectContext.Provider>
  ));

  return { app, connected, emulators: made, container };
};

/** The Daemon's Event for `message`, by its status. */
export const sent = (message: Message) => event({ name: message.status === "held" ? "message.held" : message.status === "delivered" ? "message.delivered" : message.status === "dropped" ? "message.dropped" : "message.sent", data: message });

export const rowsOf = (): string[] => [...document.querySelectorAll(".note-queue-row")].map((row) => row.querySelector(".note-queue-text")?.textContent ?? "");
