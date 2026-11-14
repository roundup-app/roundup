import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { ConnectedProjectContext } from "../state/connectedProject";
import { Capture } from "../todos/Capture";
import { mountTodos } from "../todos/testHarness";

afterEach(cleanup);

it("u3737_the_open_value_opens_the_field_again_after_each_close", async () => {
  const mounted = await mountTodos([]);
  const [open, setOpen] = createSignal(false);
  const changes: boolean[] = [];
  render(() => <ConnectedProjectContext.Provider value={mounted.connected}><Capture open={open()} onOpenChange={next => { changes.push(next); setOpen(next); }} onFile={undefined} /></ConnectedProjectContext.Provider>);

  for (let round = 0; round < 2; round++) {
    setOpen(true);
    fireEvent.keyDown(within(await screen.findByRole("dialog")).getByRole("textbox"), { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(changes.at(-1)).toBe(false);
  }
});
