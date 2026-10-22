import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { copy } from "../copy";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, workstream } from "../testing/nodes";
import { mountRail, railCallsTo, rowOf, settled } from "./railFixture";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NAME = `payments workstream ${"with a very long tail ".repeat(3)}`.trim();

const tree = () => [workstream("w", { name: NAME }), agent("a", "idle", "working on it", { parent: "w" }), door("d", "working", "supervising", { order: 1 })];

const tips = () => screen.queryAllByRole("tooltip").map((tip) => tip.textContent);

it("u521_icon_controls_show_their_names", { timeout: 60_000 }, async () => {
  await mountRail(tree());

  const icons = [...document.querySelectorAll<HTMLButtonElement>(".rail-tree button")].filter((button) => (button.textContent ?? "").trim() === "");

  expect(icons.length).toBeGreaterThan(2);

  const seen = new Set<string>();

  for (const button of icons) {
    if (seen.has(button.getAttribute("aria-label") ?? "")) continue;
    seen.add(button.getAttribute("aria-label") ?? "");
    const name = button.getAttribute("aria-label") ?? "";

    expect(name).not.toBe("");
    expect(button.getAttribute("title") ?? "").toBe("");

    // Hover and keyboard focus each open the name, independently of the other.
    fireEvent.pointerMove(button, { pointerType: "mouse" });
    await waitFor(() => expect(tips().some((tip) => tip.startsWith(name))).toBe(true));
    fireEvent.pointerLeave(button, { pointerType: "mouse" });
    await waitFor(() => expect(tips().some((tip) => tip.startsWith(name))).toBe(false));

    fireEvent.keyDown(document, { key: "Tab" });
    button.focus();
    await waitFor(() => expect(tips().some((tip) => tip.startsWith(name))).toBe(true));
    button.blur();
    await waitFor(() => expect(tips().some((tip) => tip.startsWith(name))).toBe(false));
  }
});

it("u521_shortcuts_follow_focus", async () => {
  const app = createFakeApp();
  app.opened.project = { name: "p", path: "/p" };
  app.handlers["rail.tree"] = () => [workstream("g"), agent("a", "idle", "x", { parent: "g" })];
  app.handlers["agent.spawn"] = () => agent("fresh", "idle", "starting", { parent: "g" });
  render(() => <App app={app} reducedMotion={() => false} clock={() => 0} />);
  await waitFor(() => rowOf("a"));

  // Rail focus: the registry selects the Rail's ⌘N.
  rowOf("a").focus();
  fireEvent.keyDown(rowOf("a"), { key: "n", metaKey: true });
  await waitFor(() => expect(railCallsTo(app, "agent.spawn")).toHaveLength(1));

  // An open Help suppresses the underlying action.
  fireEvent.keyDown(rowOf("a"), { key: "?", shiftKey: true });
  await waitFor(() => expect(document.querySelector(".help")).not.toBeNull());
  fireEvent.keyDown(document.querySelector(".help")!, { key: "n", metaKey: true });
  await settled();
  expect(railCallsTo(app, "agent.spawn")).toHaveLength(1);
});

it("u521_shortcuts_leave_no_stale_callback", async () => {
  const { app } = await mountRail([workstream("g")]);
  app.handlers["agent.spawn"] = () => agent("fresh", "idle", "starting", { parent: "g" });

  fireEvent.keyDown(document, { key: "n", metaKey: true });
  await waitFor(() => expect(railCallsTo(app, "agent.spawn")).toHaveLength(1));

  cleanup();
  fireEvent.keyDown(document, { key: "n", metaKey: true });
  await settled();

  expect(railCallsTo(app, "agent.spawn")).toHaveLength(1);
});

it("u521_copy_preserves_content", async () => {
  // Names and returned errors stay verbatim; the labels come from the catalogue.
  const odd = "«ünï/cødé» a b";
  await mountRail([workstream("w", { name: odd })]);

  expect(screen.getByText(odd).textContent).toBe(odd);
  expect(screen.getByRole("button", { name: copy.collapse })).toBeTruthy();
});
