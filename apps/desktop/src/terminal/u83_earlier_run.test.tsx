import { OrderDrawer } from "../orders/OrderDrawer";
import { ConnectedProjectContext } from "../state/connectedProject";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { mountPane } from "./paneHarness";

afterEach(cleanup);

const overview = { program: "Claude Code", id: "opaque-session", name: "Recipe notebook", used: 84000, limit: 200000,
  // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- A2681c contract field.
  card: { intent: "Collect recipes", shape: "Local notebook", facts: ["Stored on disk"], outcome: "Recipes saved" } };

describe("U83 closed Agent overview", () => {
  describe("O17 the session id copies", () => {
    const setup = async (write: (text: string) => Promise<void>) => {
      const { connected, app } = await mountPane([agent("a", "done", "finished", { terminal_id: null, overview })]);
      app.clipboardWrite = write;
      render(() => <ConnectedProjectContext.Provider value={connected}><OrderDrawer id="a" inline /></ConnectedProjectContext.Provider>);

      return await screen.findByRole("button", { name: "Copy session id" });
    };

    it("o17_clicking_the_session_id_copies_it", async () => {
      const written: string[] = [];
      const button = await setup(async (text) => { written.push(text); });
      fireEvent.click(button);
      expect(written).toEqual([overview.id]);
      await waitFor(() => expect(button.textContent).toBe(overview.id), { timeout: 2500 });
    });

    it("o17_a_failed_copy_names_the_cause_and_recovery", async () => {
      let failing = true;
      const refusal = new Error("denied");
      const written: string[] = [];

      const button = await setup(async (text) => {
        written.push(text);

        if (failing) throw refusal;
      });

      fireEvent.click(button);
      expect((await screen.findByRole("alert")).textContent).toContain(refusal.message);
      expect(button.textContent).toBe(overview.id);
      failing = false;
      fireEvent.click(button);
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
      expect(written).toEqual([overview.id, overview.id]);
    });
  });
});
