import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { withScopeRow } from "../testing/showEverything";
import { agent } from "../testing/nodes";
import { AGENT, openPad, openShelf, padOf } from "./padsFixture";
import { USER } from "./owner";

afterEach(cleanup);

const OWNER = "agent-7f3";

const running = () => agent(OWNER, "working", "editing", { name: "auth-refactor", terminal_id: "t-owner" });

/** The Pad is opened from the Shelf while its owner is off the Rail, then the owner joins it. */
const openOwned = async (over: { exited?: boolean; resumable?: boolean; resumeFails?: string } = {}) => {
  const shelf = await openShelf([padOf("auth-notes", AGENT, "x")]);
  const { app, connected } = shelf;
  let live = !over.exited;

  await openPad("auth-notes");

  app.handlers["rail.tree"] = () => withScopeRow([{ ...running(), can_resume: over.resumable ?? false }]);
  app.handlers["terminal.list"] = () =>
    live ? [] : [{ id: "t-owner", incarnation: "fixture-owner", cwd: "/p", title: null, program: "claude", running: false, exit_code: 0, owner: OWNER }];
  app.handlers["agent.resume"] = () => {
    if (over.resumeFails) throw new Error(over.resumeFails);

    live = true;

    return running();
  };

  await connected.rail.refresh({ terminals: true });

  return shelf;
};

const openOwnerButton = () => screen.findByRole("button", { name: "Open owner" });

describe("u432 open owner", () => {
  it("u432_agent_pad_has_owner_name_in_tooltip", async () => {
    await openOwned();

    fireEvent.pointerMove(await openOwnerButton(), { pointerType: "mouse" });
    await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe("Open owner: auth-refactor"));
  });

  it("u432_user_pad_has_no_open_owner", async () => {
    const { connected } = await openShelf([padOf("mine", USER, "x")]);
    await openPad("mine");
    await connected.rail.refresh();

    expect(screen.queryByRole("button", { name: "Open owner" })).toBeNull();
  });

  it("u432_removed_owner_has_no_button", async () => {
    const { app, connected } = await openShelf([padOf("auth-notes", AGENT, "x")]);
    await openPad("auth-notes");
    app.handlers["rail.tree"] = () => withScopeRow([]);
    await connected.rail.refresh();

    expect(screen.queryByRole("button", { name: "Open owner" })).toBeNull();
  });

  it("u432_open_owner_selects_the_owner", async () => {
    const { connected } = await openOwned();

    fireEvent.click(await openOwnerButton());
    await waitFor(() => expect(connected.rail.selected()).toBe(OWNER));
  });

  it("u432_drawer_stays_open", async () => {
    const { connected } = await openOwned();

    fireEvent.click(await openOwnerButton());
    await waitFor(() => expect(connected.rail.selected()).toBe(OWNER));

    expect(within(screen.getByLabelText("Drawer")).getByRole("textbox", { name: "Pad body" })).toBeTruthy();
  });

  it("u432_exited_owner_is_resumed_first", async () => {
    const { app, connected } = await openOwned({ exited: true, resumable: true });

    fireEvent.click(await openOwnerButton());
    await waitFor(() => expect(app.calls.some((call) => call.method === "agent.resume")).toBe(true));

    expect(connected.rail.selected()).toBe(OWNER);
  });

  it("u432_open_owner_failure_shows_its_message", async () => {
    await openOwned({ exited: true, resumable: true, resumeFails: "the terminal is busy" });

    fireEvent.click(await openOwnerButton());

    expect(await screen.findByText(/the terminal is busy/)).toBeTruthy();
    expect(screen.getByLabelText("Drawer")).toBeTruthy();
  });
});
