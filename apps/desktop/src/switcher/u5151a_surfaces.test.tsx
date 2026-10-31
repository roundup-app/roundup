import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, NOW } from "../testing/nodes";
import { field, mountSwitcher, openSwitcher } from "./switcherFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

const LABEL = "Claude's servers failed; send the Agent a message to retry. The next turn replaces this mark.";
const failed = agent("cy", "error", "x", { name: "Cy", status: { kind: "error", label: LABEL, since: NOW, finished: "0" } });
const TURNS = /^(agent|terminal)\.(send|write|stop|restart)|^(message|workstream)\./;

describe("U5151a", () => {
  it("u5151a_each_error_surface_explains_recovery", async () => {
    await mountSwitcher(null, [failed]);

    expect(screen.getByRole("treeitem", { name: /Cy/ }).textContent).toContain(LABEL);

    openSwitcher();
    await waitFor(() => expect(field()).not.toBeNull());
    expect(document.querySelector(".switcher")!.textContent).toContain(LABEL);
  });

  it("u5151a_reading_a_failure_spends_no_turn", async () => {
    const { app } = await mountSwitcher(null, [failed]);

    openSwitcher();
    await waitFor(() => expect(field()).not.toBeNull());
    fireEvent.focus(screen.getByRole("treeitem", { name: /Cy/ }));
    fireEvent.pointerEnter(screen.getByRole("treeitem", { name: /Cy/ }));

    expect(app.calls.map((call) => call.method).filter((method) => TURNS.test(method))).toEqual([]);
  });
});
