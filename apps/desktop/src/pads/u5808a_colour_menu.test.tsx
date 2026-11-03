import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { openPad, openShelf, padOf } from "./padsFixture";
import { USER } from "../testing/nodes";

afterEach(cleanup);

it("u5808a_keyboard_open_and_escape_keep_the_colour_trigger", async () => {
  const source = 'before **word** after  \n\n<mark><span data-pad-color="blue">keep</span></mark>\n';
  const { app, connected, state } = await openShelf([padOf("note", USER, source)]);
  const field = await openPad("note");
  field.setSelectionRange(8, 12, "forward");
  const selection = [field.selectionStart, field.selectionEnd, field.selectionDirection];
  const trigger = screen.getByRole("button", { name: "Text colour" });
  const user = userEvent.setup();
  trigger.focus();

  for (const key of ["{Enter}", "{Enter}", " "]) {
    await user.keyboard(key);
    const menu = await screen.findByRole("menu", { name: "Text colour" });
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Text colour" })).toEqual([trigger]);
    expect(document.getElementById(menu.getAttribute("aria-labelledby")!)).toBe(trigger);
    expect([...document.querySelectorAll("[id]")].filter(node => node.id === trigger.id)).toEqual([trigger]);
    expect(document.getElementById(trigger.getAttribute("aria-controls")!)).toBe(menu);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual(selection);
    expect(field.value).toBe(source.trimEnd());
  }

  fireEvent.focusOut(field);
  connected.drawer.close();
  await openPad("note");
  expect(state.pads[0]?.text).toBe(source);
  expect(app.calls.filter(call => call.method === "pad.write")).toHaveLength(0);
});
