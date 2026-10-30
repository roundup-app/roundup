import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createComponent } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { createDrawer } from "../drawer/drawer";
import { DrawerHost } from "../drawer/DrawerHost";
import { questionDialog, answerQuestion } from "../shelf/bulkQuestionHarness";
import { questionProbe } from "../testing/menuProbe";
import { agent } from "../testing/nodes";
import { openTabs, tab } from "./stripFixture";

afterEach(cleanup);

it("u495_tabs_preserve_project_actions", async () => {
  await openTabs({ api: [], web: [] });
  const origin = tab("api");
  origin.focus();
  fireEvent.keyDown(origin, { key: "ArrowRight" });
  await waitFor(() => expect(document.activeElement).toBe(tab("web")));
  fireEvent.keyDown(tab("web"), { key: "Enter" });
  await waitFor(() => expect(tab("web").getAttribute("aria-selected")).toBe("true"));
  const selected = tab("web");
  const panel = document.getElementById(selected.getAttribute("aria-controls")!);
  expect(panel?.getAttribute("role")).toBe("tabpanel");
  expect(panel?.getAttribute("aria-labelledby")).toBe(selected.id);
  expect(document.querySelector("button button")).toBeNull();
});

for (const away of [false, true]) it(`u496_drawer_escape_and_return_${away}`, async () => {
  await openTabs({ api: [], web: [] });
  const origin = tab("api");
  origin.focus();
  const drawer = createDrawer();
  const view = render(() => createComponent(DrawerHost, { drawer, reducedMotion: () => true }));
  drawer.open(() => document.createElement("p"));
  const close = within(view.container).getByRole("button", { name: "Close" });
  await waitFor(() => expect(document.activeElement).toBe(close));
  const outside = tab("web");

  if (away) outside.focus();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(drawer.content()).toBeNull());
  expect(document.activeElement).toBe(away ? outside : origin);
});

it("u497_no_native_titles", async () => {
  const name = "Full authored Project name 雪 🧭";
  await openTabs({ api: [] });
  fireEvent.dblClick(tab("api").querySelector(".tab-name")!);
  const field = await screen.findByRole("textbox", { name: "Project name" });
  fireEvent.input(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: "Enter" });
  const title = await screen.findByRole("heading", { level: 1, name });
  const linkedTip = () => document.getElementById(title.getAttribute("aria-describedby") ?? "");
  fireEvent.pointerOver(title, { pointerType: "mouse" });
  await waitFor(() => expect(linkedTip()?.getAttribute("role")).toBe("tooltip"));
  expect(linkedTip()?.textContent).toBe(name);
  fireEvent.pointerLeave(title, { pointerType: "mouse" });
  await waitFor(() => expect(linkedTip()).toBeNull());
  fireEvent.keyDown(document.body, { key: "Tab" });
  title.focus();
  await waitFor(() => expect(linkedTip()?.getAttribute("role")).toBe("tooltip"));
  expect(linkedTip()?.textContent).toBe(name);
  expect(document.querySelectorAll(".header [title],.drawer [title]")).toHaveLength(0);
});

it("u494_removed_origin_is_safe", async () => {
  await openTabs({ api: [agent("a", "working", "x")], web: [] });
  const close = screen.getByLabelText("Close api");
  close.focus();
  fireEvent.click(close);
  await questionDialog();
  close.remove();
  await answerQuestion(false);
  await waitFor(() => expect(questionProbe.shown).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(tab("web")));
  expect(document.activeElement?.isConnected).toBe(true);
});
