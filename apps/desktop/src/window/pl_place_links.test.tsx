import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";
import { notices } from "../testing/notices";
import type { NativeOpen } from "../app/seam";
import type { ConnectedProject } from "../state/connectedProject";
import "./nativeOpen";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });

const KEY = "project-0000000000000000";

const mount = async () => {
  const app = createFakeApp();
  app.add("/project");
  app.handlers["rail.tree"] = () => [];
  app.handlers["terminal.list"] = () => [];
  const idle = () => {};

  let receive: (request: NativeOpen) => void = idle;

  app.onNativeOpen = listener => {
    receive = listener;

    return () => {};
  };

  let connected!: ConnectedProject;
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} prepareIdle={open => { connected = open; }} />);
  await waitFor(() => expect(connected).toBeDefined());
  await waitFor(() => expect(receive).not.toBe(idle));

  return { app, receive: (request: NativeOpen) => receive(request) };
};

const selectedTabs = () => screen.getAllByRole("tab", { selected: true }).map(tab => tab.getAttribute("data-value"));

it("pl1_a_shelf_link_opens_the_bench_at_its_tab", async () => {
  const m = await mount();

  m.receive({ kind: "link", url: `roundup://shelf/pads?project=${KEY}` });
  await waitFor(() => expect(selectedTabs()).toContain("pads"));
  expect(notices("alert")).toEqual([]);
});

it("pl1_an_unknown_tab_fails_visibly_and_opens_nothing", async () => {
  const m = await mount();

  for (const [url, line] of [
    [`roundup://shelf/notes?project=${KEY}`, "notes"],
    [`roundup://shelf/pads?project=${KEY}#x`, "pads"],
    ["roundup://shelf/pads?project=other-0000000000000000", "other-0000000000000000"],
  ] as const) {
    m.receive({ kind: "link", url });
    expect((await screen.findByText(text => text.includes(line))).textContent).toContain(line);
  }

  expect(screen.queryAllByRole("tab", { name: "Pads", selected: true })).toEqual([]);
});

it("pl2_a_settings_link_opens_its_page_and_focuses_the_control", async () => {
  const m = await mount();

  m.receive({ kind: "link", url: `roundup://settings/agents?project=${KEY}#model` });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Model")));
});

it("pl2_opening_a_settings_link_changes_no_setting", async () => {
  const m = await mount();
  const before = localStorage.getItem("roundup:app-settings");

  m.receive({ kind: "link", url: `roundup://settings/agents?project=${KEY}#model` });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Model")));
  expect(localStorage.getItem("roundup:app-settings")).toBe(before);
  expect(m.app.calls.map(call => call.method).filter(method => /set|save|write/i.test(method))).toEqual([]);
});

it("pl2_a_settings_link_moves_an_open_settings", async () => {
  const m = await mount();

  m.receive({ kind: "link", url: `roundup://settings/appearance?project=${KEY}` });
  await screen.findByRole("tab", { name: "Appearance", selected: true });
  m.receive({ kind: "link", url: `roundup://settings/terminal?project=${KEY}#fontSize` });
  await screen.findByRole("tab", { name: "Terminal", selected: true });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Font size")));
});

it("pl2_an_unknown_page_or_control_fails_visibly", async () => {
  const m = await mount();

  m.receive({ kind: "link", url: `roundup://settings/appearance?project=${KEY}` });
  await screen.findByRole("tab", { name: "Appearance", selected: true });

  for (const [url, line] of [
    [`roundup://settings/nowhere?project=${KEY}`, "nowhere"],
    [`roundup://settings/agents?project=${KEY}#fontSize`, "fontSize"],
    ["roundup://settings/agents?project=other-0000000000000000", "other-0000000000000000"],
  ] as const) {
    m.receive({ kind: "link", url });
    expect((await screen.findByText(text => text.includes(line))).textContent).toContain(line);
    expect(selectedTabs()).toContain("Appearance");
  }
});
