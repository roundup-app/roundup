import { batch } from "solid-js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door } from "../testing/nodes";
import { ForkSheet } from "./ForkSheet";
import { forkRows } from "./forkTicks";

const FIRST = { name: "payments-api", path: "/Users/me/repos/payments-api" };
const SECOND = { name: "docs", path: "/Users/me/repos/docs" };

const tree = [
  door("d1", "working", "Door", { name: "Door", order: 0 }),
  agent("a1", "working", "one", { name: "Agent one", parent: "d1", order: 0 }),
  agent("a2", "working", "two", { name: "Agent two", parent: "d1", order: 1 }),
  agent("a3", "working", "three", { name: "Agent three", order: 1 }),
];

const rows = () => forkRows([{ path: FIRST.path, name: FIRST.name, nodes: tree }, { path: SECOND.path, name: SECOND.name, nodes: [] }]);

afterEach(() => { batch(cleanup); vi.restoreAllMocks(); window.localStorage.clear(); });

const sheet = async (override: (app: ReturnType<typeof createFakeApp>) => void = () => {}) => {
  const app = createFakeApp();

  override(app);
  render(() => <ForkSheet app={app} open rows={rows} onClose={() => {}} />);
  await screen.findByRole("dialog");

  return app;
};

const box = (name: string) => screen.getByRole("checkbox", { name });

describe("fs5979a the application menu offers the sheet", () => {
  it("fs5979a_the_menu_event_opens_one_sheet", async () => {
    const app = createFakeApp();

    app.opened.project = FIRST;
    app.handlers["rail.tree"] = () => tree;
    render(() => <App app={app} reducedMotion={() => false} clock={() => 0} />);
    await within(await screen.findByLabelText("Projects", { selector: '[role="tablist"]' })).findByRole("tab", { name: FIRST.name });
    window.dispatchEvent(new Event("open-fork-sheet"));
    await screen.findByRole("dialog", { name: "Fork for development" });
    window.dispatchEvent(new Event("open-fork-sheet"));
    await Promise.resolve();

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(await screen.findByRole("checkbox", { name: "Agent two" })).toBeTruthy();
  });
});

describe("fs5979b the sheet is the Rail tree with every row ticked", () => {
  it("fs5979b_every_row_is_ticked_in_the_rails_nesting", async () => {
    await sheet();

    const names = screen.getAllByRole("checkbox").map(each => each.getAttribute("aria-label"));

    expect(names).toEqual([FIRST.name, "Door", "Agent one", "Agent two", "Agent three", SECOND.name]);
    screen.getAllByRole("checkbox").forEach(each => expect(each.getAttribute("aria-checked")).toBe("true"));
  });

  it("fs5979b_unticking_clears_the_rows_under_it_and_a_part_ticked_parent_is_mixed", async () => {
    await sheet();
    fireEvent.click(box("Agent one"));

    expect(box("Door").getAttribute("aria-checked")).toBe("mixed");
    expect(box(FIRST.name).getAttribute("aria-checked")).toBe("mixed");
    fireEvent.click(box("Door"));
    fireEvent.click(box("Door"));
    expect(["Door", "Agent one", "Agent two"].map(name => box(name).getAttribute("aria-checked"))).toEqual(["false", "false", "false"]);
    fireEvent.click(box(FIRST.name));
    fireEvent.click(box(FIRST.name));
    expect(box("Agent three").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box("Agent two"));
    expect(["Agent two", "Door", FIRST.name].map(name => box(name).getAttribute("aria-checked"))).toEqual(["true", "mixed", "mixed"]);
  });

  it("fs5979b_opening_again_shows_every_row_ticked", async () => {
    const app = createFakeApp();
    const view = render(() => <ForkSheet app={app} open rows={rows} onClose={() => {}} />);

    await screen.findByRole("dialog");
    fireEvent.click(box(SECOND.name));
    view.unmount();
    render(() => <ForkSheet app={app} open rows={rows} onClose={() => {}} />);
    await screen.findByRole("dialog");

    expect(box(SECOND.name).getAttribute("aria-checked")).toBe("true");
  });
});

describe("fs5979c the name and the colour", () => {
  it("fs5979c_the_name_is_the_branch_selected_and_teal_is_chosen_first", async () => {
    await sheet(app => { app.forkBranch = async () => "build/login"; });
    const field = await screen.findByLabelText("Name") as HTMLInputElement;

    await waitFor(() => expect(field.value).toBe("build/login"));
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, "build/login".length]);
    expect(screen.getAllByRole("radio")).toHaveLength(8);
    await waitFor(() => expect((screen.getByRole("radio", { name: "teal" }) as HTMLInputElement).checked).toBe(true));
    screen.getByRole("radio", { name: "teal" }).focus();
    await userEvent.setup().keyboard("{ArrowRight}");
    await waitFor(() => expect((screen.getByRole("radio", { name: "blue" }) as HTMLInputElement).checked).toBe(true));
  });

  it.each(["", "x".repeat(41), "a\u0007b"])("fs5979c_an_invalid_name_makes_no_fork", async (bad) => {
    const forkMake = vi.fn(async () => {});
    await sheet(app => { app.forkMake = forkMake; });
    const field = await screen.findByLabelText("Name");

    await waitFor(() => expect((field as HTMLInputElement).value).toBe("fork"));
    fireEvent.input(field, { target: { value: bad } });
    fireEvent.submit(field.closest("form")!);
    await Promise.resolve();

    expect(forkMake).not.toHaveBeenCalled();
  });
});

describe("fs5979d Enter makes the Fork", () => {
  it("fs5979d_sends_the_picks_once_and_closes_after_the_call", async () => {
    let finish: () => void = () => {};
    const forkMake = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const onClose = vi.fn();
    const app = createFakeApp();

    app.forkMake = forkMake;
    render(() => <ForkSheet app={app} open rows={rows} onClose={onClose} />);
    const field = await screen.findByLabelText("Name");

    await waitFor(() => expect((field as HTMLInputElement).value).toBe("fork"));
    fireEvent.click(box("Agent one"));
    fireEvent.click(box(SECOND.name));
    fireEvent.submit(field.closest("form")!);
    fireEvent.submit(field.closest("form")!);

    expect(forkMake).toHaveBeenCalledTimes(1);
    expect(forkMake).toHaveBeenCalledWith({ name: "fork", colour: "teal", projects: [{ key: FIRST.path, agents: ["d1", "a2", "a3"] }] });
    expect((screen.getByRole("button", { name: "Make Fork" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("fs5979d_agents_are_all_none_or_the_ticked_ids", async () => {
    const forkMake = vi.fn(async () => {});
    await sheet(app => { app.forkMake = forkMake; });
    const field = await screen.findByLabelText("Name");

    await waitFor(() => expect((field as HTMLInputElement).value).toBe("fork"));
    fireEvent.submit(field.closest("form")!);
    await waitFor(() => expect(forkMake).toHaveBeenCalledTimes(1));
    expect(forkMake.mock.calls[0]).toEqual([{ name: "fork", colour: "teal", projects: [{ key: FIRST.path, agents: "all" }, { key: SECOND.path, agents: "all" }] }]);
  });
});

describe("fs5979e a failed Fork stays on the sheet", () => {
  it("fs5979e_a_rejection_keeps_the_choices_and_a_retry_closes", async () => {
    const forkMake = vi.fn().mockRejectedValueOnce(new Error("no space left")).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const app = createFakeApp();

    app.forkMake = forkMake;
    render(() => <ForkSheet app={app} open rows={rows} onClose={onClose} />);
    const field = await screen.findByLabelText("Name");

    await waitFor(() => expect((field as HTMLInputElement).value).toBe("fork"));
    fireEvent.click(box("Agent one"));
    fireEvent.input(field, { target: { value: "mine" } });
    fireEvent.submit(field.closest("form")!);

    expect((await screen.findByRole("alert")).textContent).toBe("no space left");
    expect(onClose).not.toHaveBeenCalled();
    expect(box("Agent one").getAttribute("aria-checked")).toBe("false");
    expect((field as HTMLInputElement).value).toBe("mine");
    expect((screen.getByRole("button", { name: "Make Fork" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.submit(field.closest("form")!);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(forkMake).toHaveBeenCalledTimes(2);
  });
});
