import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";
import { OWN_CONTRACT } from "../app/contractMatch";
import { notices } from "../testing/notices";
import type { NativeOpen } from "../app/seam";
import type { ConnectedProject } from "../state/connectedProject";
import "./nativeOpen";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });

const KEY = "project-0000000000000000";

const mount = async (second = false) => {
  const app = createFakeApp();
  app.add("/project");

  if (second) {
    app.add("/second");
    app.of("/second").handlers["daemon.ping"] = () => ({ pong: true, pid: 2, project: "/second", projectKey: "second-0000000000000000", contract: { fingerprint: OWN_CONTRACT.fingerprint } });
    app.of("/second").handlers["rail.tree"] = () => [];
    app.of("/second").handlers["terminal.list"] = () => [];
  }

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

const projectGet = (command: string) => () => ({ worktrees: { on: false, check: null }, mcp: { on: true }, workstreamCap: 2, machine: null, program: { argv: [command], dir: "." }, models: { roles: [] } });

it("u7887c_a_project_settings_link_focuses_the_program_command", async () => {
  const m = await mount();
  m.app.handlers["project.get"] = projectGet("pnpm");

  m.receive({ kind: "link", url: `roundup://settings/project?project=${KEY}#program` });
  await screen.findByRole("tab", { name: "Project", selected: true });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Command")));
  expect(screen.getByLabelText<HTMLTextAreaElement>("Command").value).toBe("pnpm");
  expect(m.app.calls.map(call => call.method).filter(method => /set|clear/i.test(method))).toEqual([]);

  // A link naming no Project names the selected one.
  m.receive({ kind: "link", url: "roundup://settings/project#workstreams" });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Workstreams at once")));
});

it("u7887c_a_link_names_a_project_that_is_open_but_not_selected", async () => {
  const m = await mount(true);
  m.app.of("/project").handlers["project.get"] = projectGet("first");
  m.app.of("/second").handlers["project.get"] = projectGet("second");
  const selected = selectedTabs();

  m.receive({ kind: "link", url: "roundup://settings/project?project=second-0000000000000000#program" });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Command")));
  expect(screen.getByLabelText<HTMLTextAreaElement>("Command").value).toBe("second");
  expect(screen.getAllByRole("tab", { selected: true }).map(tab => tab.getAttribute("data-value")).filter(value => value !== "Project")).toEqual(selected.filter(value => value !== "Project"));
});

it("u7887c_a_link_with_no_project_or_an_unknown_one_fails_visibly", async () => {
  const m = await mount();

  m.receive({ kind: "link", url: `roundup://settings/appearance?project=${KEY}` });
  await screen.findByRole("tab", { name: "Appearance", selected: true });

  for (const [url, line] of [
    ["roundup://settings/project?project=other-0000000000000000#program", "other-0000000000000000"],
    [`roundup://settings/project?project=${KEY}#nowhere`, "nowhere"],
  ] as const) {
    m.receive({ kind: "link", url });
    expect((await screen.findByText(text => text.includes(line))).textContent).toContain(line);
    expect(selectedTabs()).toContain("Appearance");
  }
});

const projectTab = (name: string) => screen.getByRole("tab", { name });

it("u7887a_settings_lists_a_project_page_for_the_selected_project", async () => {
  const m = await mount(true);
  m.app.of("/project").handlers["project.get"] = projectGet("first");
  m.app.of("/second").handlers["project.get"] = projectGet("second");

  window.dispatchEvent(new Event("open-app-settings"));
  fireEvent.click(await screen.findByRole("tab", { name: "Project" }));
  await waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>("Command").value).toBe("second"));

  fireEvent.click(projectTab("project"));
  await waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>("Command").value).toBe("first"));
});

it("u7887a_with_no_project_settings_lists_no_project_page", async () => {
  const app = createFakeApp();
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);

  await screen.findByRole("button", { name: /Choose/ });
  window.dispatchEvent(new Event("open-app-settings"));
  await screen.findByRole("tab", { name: "Terminal" });
  expect(screen.getAllByRole("tab").map(tab => tab.getAttribute("data-value"))).not.toContain("Project");
});

it("u7887a_the_project_page_holds_workstreams_then_program", async () => {
  const m = await mount();
  m.app.handlers["project.get"] = projectGet("pnpm");

  m.receive({ kind: "link", url: `roundup://settings/project?project=${KEY}` });
  const cap = await screen.findByLabelText("Workstreams at once");
  const command = screen.getByLabelText("Command");
  const fields = Array.from(document.querySelectorAll("input, textarea"));
  expect(fields.indexOf(cap)).toBeLessThan(fields.indexOf(command));
  screen.getByLabelText("Folder");
  screen.getByLabelText("Worktree path");
  await screen.findByRole("button", { name: /^Clear/ });
});

it("u7887b_a_commit_names_the_project_the_page_shows", async () => {
  const m = await mount(true);
  m.app.of("/project").handlers["project.get"] = projectGet("first");
  m.app.of("/second").handlers["project.get"] = projectGet("second");
  m.app.of("/second").handlers["project.setProgram"] = () => null;
  m.receive({ kind: "link", url: "roundup://settings/project?project=second-0000000000000000#program" });
  const command = await screen.findByLabelText<HTMLTextAreaElement>("Command");
  await waitFor(() => expect(command.value).toBe("second"));

  fireEvent.input(command, { target: { value: "serve" } });
  fireEvent.keyDown(command, { key: "Enter" });
  await waitFor(() => expect(m.app.of("/second").calls.filter(call => call.method === "project.setProgram").map(call => call.params)).toEqual([{ argv: ["serve"], dir: "." }]));
  expect(m.app.of("/project").calls.filter(call => call.method === "project.setProgram")).toEqual([]);
});
