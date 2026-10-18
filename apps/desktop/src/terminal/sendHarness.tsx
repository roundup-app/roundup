import { expect } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { RailNode } from "@contracts/agent/RailNode";
import type { RpcMethods } from "@contracts/methods";
import { createSignal } from "solid-js";
import { ConnectedProjectContext } from "../state/connectedProject";
import { message } from "../testing/centreFixture";
import { info, terminal, USER } from "../testing/nodes";
import { createToastQueue } from "../toasts/queue";
import { Toasts } from "../toasts/Toasts";
import { Pane } from "./Pane";
import { connectFakeProject, fakeEmulators } from "./paneHarness";

type Params = RpcMethods["message.send"]["params"];

/** A shell Terminal `sh` selected in the Pane over `others`, with the Toasts beside it and a Daemon that answers `message.send` with `answer`. */
export const mountSend = async (others: RailNode[], answer: (params: Params) => void = () => {}) => {
  const { app, connected } = await connectFakeProject([terminal("sh"), ...others], [info("t-sh")]);
  const { factory, made } = fakeEmulators();
  const [front] = createSignal(true);
  const chimes = { count: 0 };
  const toasts = createToastQueue(front, () => { chimes.count += 1; });
  const sent: Params[] = [];

  app.handlers["message.send"] = (params) => {
    sent.push(params);
    answer(params);

    return message(99, { from: USER, to: params.to, body: params.body });
  };

  const view = render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Pane createEmulator={factory} toasts={toasts} />
      <Toasts queue={toasts} />
    </ConnectedProjectContext.Provider>
  ));

  connected.rail.select("sh");
  await waitFor(() => expect(made.get("t-sh")).toBeDefined());

  return { app, connected, emulator: made.get("t-sh")!, calls: () => sent, chimes, ...view };
};

export const pressShortcut = (view: { container: HTMLElement }) => {
  const target = view.container.querySelector<HTMLElement>("[data-terminal]")!;

  target.focus();

  return target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "a", code: "KeyA", metaKey: true, shiftKey: true }));
};

export const control = () => screen.queryByRole("button", { name: "Send to agent" });

export { fireEvent, screen, waitFor };
