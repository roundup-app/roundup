import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copy } from "./copy";
import { lines } from "./PadChanges";
import { AGENT, openPad, openShelf, padOf, waitForReload } from "./padsFixture";
import { keptTextCap, padReadStorage, padReadTextStorage } from "./padRead";
import type { Pad } from "@contracts/pad/Pad";

vi.setConfig({ testTimeout: 30_000 });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const NAME = "plan";

const at = (revision: number, text: string): Pad => ({ ...padOf(NAME, AGENT, text), revision });

const actions = () => screen.queryAllByRole("button", { name: copy.changesSince }).length;

/** The changed values the diff function last returned. */
const changed = (diff: { mock: { results: { value: unknown }[] } }) => {
  const last = diff.mock.results.at(-1)?.value;

  return Array.isArray(last) ? last.filter(part => part.added || part.removed).map(part => part.value) : [];
};

const diffs = () => document.querySelectorAll(".pad-changes").length;

const parts = (kind: string) => document.querySelectorAll(`[data-change="${kind}"]`).length;

/** The user read Revision 3 with this text, has the Pad open, and an Agent then writes Revision 4. */
const open = async (read: string) => {
  padReadTextStorage("/p").write({});

  const opened = await openShelf([at(3, read)], false, false, "/p", { read: { [`fixture-${NAME}`]: "3" } });
  const field = await openPad(NAME);

  return { ...opened, field };
};

const agentWrites = async (opened: Awaited<ReturnType<typeof open>>, revision: number, text: string, reloads = revision - 3) => {
  opened.state.pads = [at(revision, text)];
  opened.app.emit({ actor: AGENT, name: "pad.changed", data: { name: NAME } });
  await waitForReload(opened.app, reloads);
};

describe("u7706a a Pad changed since the user read it shows what changed", () => {
  it("u7706a_the_record_keeps_the_text_of_the_revision_read", async () => {
    const opened = await open("one\ntwo\n");

    await waitFor(() => expect(padReadTextStorage("/p").read()).toEqual({ [`fixture-${NAME}`]: "one\ntwo\n" }));
    opened.state.pads = [at(4, "one\nthree\n")];
    cleanup();
    await openShelf([at(4, "one\nthree\n")], false, false, "/p", { read: { [`fixture-${NAME}`]: "3" } });
    await openPad(NAME);
    await waitFor(() => expect(padReadTextStorage("/p").read()).toEqual({ [`fixture-${NAME}`]: "one\nthree\n" }));
    expect(padReadStorage("/p").read()).toEqual({ [`fixture-${NAME}`]: "4" });
    expect(padReadTextStorage("/other").read()).toBeNull();
  });

  it("u7706a_a_pad_over_the_cap_keeps_no_text", async () => {
    const opened = await open("x".repeat(keptTextCap + 1));

    await agentWrites(opened, 4, "y");
    expect(padReadTextStorage("/p").read()?.[`fixture-${NAME}`]).toBeUndefined();
  });

  it("u7706a_the_action_shows_only_while_the_pad_changed", async () => {
    const opened = await open("one\n");

    expect(actions()).toBe(0);
    await agentWrites(opened, 4, "two\n");
    await waitFor(() => expect(actions()).toBe(1));
  });

  it("u7706a_the_diff_holds_the_changed_lines", async () => {
    const diff = vi.spyOn(lines, "diff");
    const opened = await open("keep\nold line\n");

    await agentWrites(opened, 4, "keep\nnew line\n");
    fireEvent.click(await screen.findByRole("button", { name: copy.changesSince }));

    expect(parts("removed")).toBe(1);
    expect(parts("added")).toBe(1);
    expect(changed(diff)).toEqual(["old line\n", "new line\n"]);
    const toggle = screen.getByRole("button", { name: copy.changesSince });

    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(diffs()).toBe(0);
  });

  it("u7706a_nothing_is_computed_before_the_click", async () => {
    const diff = vi.spyOn(lines, "diff");
    const opened = await open("a\n");

    await agentWrites(opened, 4, "b\n");
    await screen.findByRole("button", { name: copy.changesSince });
    expect(diff).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: copy.changesSince }));
    expect(diff).toHaveBeenCalled();
  });

  it("u7706a_reading_again_clears_the_action", async () => {
    const opened = await open("a\n");

    await agentWrites(opened, 4, "b\n");
    fireEvent.click(await screen.findByRole("button", { name: copy.changesSince }));
    cleanup();
    await openShelf([at(4, "b\n")], false, false, "/p", { read: padReadStorage("/p").read() ?? {} });
    await openPad(NAME);
    expect(actions()).toBe(0);
    expect(diffs()).toBe(0);
  });

  it("u7706a_the_users_own_save_leaves_no_diff", async () => {
    const diff = vi.spyOn(lines, "diff");
    const opened = await open("a\n");

    fireEvent.focus(opened.field);
    flush();
    fireEvent.input(opened.field, { target: { value: "mine" } });
    flush();
    fireEvent.focusOut(opened.field);
    flush();
    await waitFor(() => expect(opened.calls().includes("pad.write")).toBe(true));
    await waitFor(() => expect(padReadStorage("/p").read()).toEqual({ [`fixture-${NAME}`]: "4" }));
    expect(actions()).toBe(0);
    await agentWrites(opened, 5, "mine\nagent", 1);
    fireEvent.click(await screen.findByRole("button", { name: copy.changesSince }));
    expect(changed(diff)).toEqual(["agent"]);
  });

  it("u7706a_a_pad_with_no_kept_text_says_so", async () => {
    const opened = await open("x".repeat(keptTextCap + 1));

    await agentWrites(opened, 4, "y");
    fireEvent.click(await screen.findByRole("button", { name: copy.changesSince }));
    expect(document.querySelectorAll(".pad-changes-none").length).toBe(1);
    expect(parts("added") + parts("removed")).toBe(0);
  });

  it("u7706a_no_daemon_call_is_added", async () => {
    const opened = await open("a\n");

    await agentWrites(opened, 4, "b\n");

    const before = opened.calls().length;

    fireEvent.click(await screen.findByRole("button", { name: copy.changesSince }));
    fireEvent.click(screen.getByRole("button", { name: copy.changesSince }));
    expect(opened.calls().length).toBe(before);
  });
});
