import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { leaveTitle, titleClosed, mountTodos, todo, todoCallsTo as callsTo } from "./testHarness";

afterEach(cleanup);

const drawer = () => screen.getByRole("complementary", { name: "Drawer" });

const open = async () => {
  const mounted = await mountTodos([todo(5, { title: "t".repeat(300), body: "one\ntwo" })], true);
  { const focusedRow = await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #5/ }); focusedRow.focus(); fireEvent.keyDown(focusedRow, { key: "Enter", code: "Enter" }); }

  await within(drawer()).findByText("one two", { exact: false }).catch(() => undefined);

  return mounted;
};

const preview = () => document.querySelector<HTMLElement>(".todo-detail-title p[tabindex]")!;
const titleField = () => within(drawer()).findByRole<HTMLTextAreaElement>("textbox", { name: "Title" });

describe("u445 edit in place", () => {
  it("u445_a_long_title_wraps_as_shown", async () => {
    await open();
    fireEvent.dblClick(preview());
    const field = await titleField();

    fireEvent.input(field, { target: { value: "a\nb" } });
    expect(field.value).toBe("a b");
  });

  it("u445_double_click_edits_the_title", async () => {
    await open();
    fireEvent.dblClick(preview());

    await waitFor(async () => expect(document.activeElement).toBe(await titleField()));
  });

  it("u445_escape_keeps_the_draft", async () => {
    const { app } = await open();
    fireEvent.dblClick(preview());
    const field = await titleField();

    fireEvent.input(field, { target: { value: "typed" } });
    fireEvent.keyDown(field, { key: "Escape" });
    await titleClosed(field);
    expect(callsTo(app, "todo.update")).toEqual([]);
    fireEvent.dblClick(preview());
    expect((await titleField()).value).toBe("typed");
  });

  it("u445_blur_submits_only_changed_non_restored_text", async () => {
    const { app } = await open();
    fireEvent.dblClick(preview());
    const idle = await titleField();

    await leaveTitle();
    await titleClosed(idle);
    expect(callsTo(app, "todo.update")).toEqual([]);

    fireEvent.dblClick(preview());

    const typed = await titleField();

    fireEvent.input(typed, { target: { value: "typed" } });
    fireEvent.keyDown(typed, { key: "Escape" });
    await titleClosed(typed);
    fireEvent.dblClick(preview());
    await titleField();
    await leaveTitle();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(callsTo(app, "todo.update")).toEqual([]);

    fireEvent.input(await titleField(), { target: { value: "typed again" } });
    fireEvent.keyDown(await titleField(), { key: "Enter" });
    await waitFor(() => expect(callsTo(app, "todo.update")).toHaveLength(1));
  });
});
