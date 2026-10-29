import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { AppSettings } from "./AppSettings";
import { createFakeApp } from "../testing/fakeApp";
import { RpcError } from "../app/seam";

afterEach(() => { cleanup(); localStorage.clear(); });

const saved = { automaticRenaming: true, namingGuide: "role-verb-object" };

const mount = async (app = createFakeApp(), project: string | null = null) => {
  app.handlers["daemon.getNaming"] = () => ({ ...saved });
  app.handlers["daemon.setNaming"] = params => { Object.assign(saved, params);

 return null; };

  render(() => <AppSettings app={app} project={() => project} />);
  await Promise.resolve();
  window.dispatchEvent(new Event("open-app-settings"));
  await screen.findByRole("textbox", { name: "Naming guide" });

  return app;
};

it("u4688a_global_naming_controls", async () => {
  const app = await mount();
  const toggle = screen.getByRole("switch", { name: "Automatic renaming" });
  expect(screen.getByRole("switch", { name: "Automatic renaming", description: /.+/ })).toBe(toggle);
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(false));
  const field = screen.getByRole("textbox", { name: "Naming guide" });
  expect(screen.getByRole("textbox", { name: "Naming guide", description: /.+/ })).toBe(field);
  fireEvent.input(field, { target: { value: "  \n " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText(/Enter a naming guide/)).toBeTruthy();
  expect(saved.namingGuide).toBe("role-verb-object");
  fireEvent.input(field, { target: { value: "役割\n動作-対象" } });
  fireEvent.blur(field);
  expect(saved.namingGuide).toBe("role-verb-object");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saved.namingGuide).toBe("役割\n動作-対象"));
  await waitFor(() => expect(JSON.parse(localStorage.getItem("roundup:drafts:naming-settings")!).drafts).toEqual([]));

  for (const project of ["/one", "/two", null]) {
    cleanup();
    await mount(app, project);
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Naming guide" }).value).toBe(saved.namingGuide);
    expect(screen.getByRole("switch", { name: "Automatic renaming" }).getAttribute("aria-checked")).toBe("false");
  }

  expect(app.calls.filter(call => !["daemon.getNaming", "daemon.setNaming", "models.list"].includes(call.method))).toEqual([]);
});

it("u4688b_guide_drafts_and_retry", async () => {
  const app = await mount();
  const committed = saved.namingGuide;
  const draft = "  役割\n動作-対象  ";
  fireEvent.input(screen.getByRole("textbox", { name: "Naming guide" }), { target: { value: draft } });
  await waitFor(() => expect(JSON.parse(localStorage.getItem("roundup:drafts:naming-settings")!).drafts.at(-1).value.text).toBe(draft));
  fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
  fireEvent.click(screen.getByRole("button", { name: "← Back" }));
  cleanup();
  await mount(app, "/other");
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Naming guide" }).value).toBe(draft);
  expect(saved.namingGuide).toBe(committed);
  let refuse!: (error: Error) => void;
  app.handlers["daemon.setNaming"] = () => new Promise((_, reject) => { refuse = reject; });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const newer = draft + "\n新しい";
  fireEvent.input(screen.getByRole("textbox", { name: "Naming guide" }), { target: { value: newer } });
  refuse(new RpcError(-32603, "Disk full; free space and retry."));
  expect(await screen.findByText(/Disk full/)).toBeTruthy();
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Naming guide" }).value).toBe(newer);
  expect(saved.namingGuide).toBe(committed);
  app.handlers["daemon.setNaming"] = params => { Object.assign(saved, params);

 return null; };

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saved.namingGuide).toBe(newer));
  expect(app.calls.filter(call => call.method === "daemon.setNaming" && JSON.stringify(call.params).includes(JSON.stringify(newer)))).toHaveLength(1);
});
