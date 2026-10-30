import { copy as appCopy } from "./copy";
import { cleanup, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";

const openApp = async () => {
  const app = createFakeApp();

  app.opened.project = { name: "payments-api", path: "/p" };
  app.handlers["rail.tree"] = () => [];
  app.handlers["terminal.list"] = () => [];

  const { container } = render(() => <App app={app} reducedMotion={() => false} clock={() => 0} />);

  await waitFor(() => expect(container.querySelector(".pane")).not.toBeNull());

  return { app, header: screen.getByRole("region", { name: "Rail" }) };
};

afterEach(cleanup);

describe("u25 disconnected protections after U3791a recovery exhaustion", () => {
  it("u25_the_header_names_the_exit_code_in_ink_after_the_project", async () => {
    const { app, header } = await openApp();

    app.exitDaemon({ code: 1, recovery: "waiting" });
    expect(within(header).queryByText(appCopy.daemonExit("exited 1"))).toBeNull();
    app.exitDaemon({ code: 1 });

    expect(within(header).getByText(appCopy.daemonExit("exited 1"))).toBeTruthy();
  });

  it("u25_a_signal_exit_reads_by_signal", async () => {
    const { app, header } = await openApp();

    app.exitDaemon({ code: null, recovery: "waiting" });
    expect(within(header).queryByText(appCopy.daemonExit("exited by signal"))).toBeNull();
    app.exitDaemon({ code: null });

    expect(within(header).getByText(appCopy.daemonExit("exited by signal"))).toBeTruthy();
  });

  it("u25_the_spawn_actions_are_disabled", async () => {
    const { app } = await openApp();

    app.exitDaemon({ code: 1 });

    for (const button of screen.getAllByRole("button", { name: /^(New Workstream|Add Workstream)$/ })) {
      expect(button.matches('[aria-disabled="true"]')).toBe(true);
    }
  });
});
