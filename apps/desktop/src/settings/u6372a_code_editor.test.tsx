import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { AppSettings } from "./AppSettings";
import { appSettings, withAppSettings } from "./preferences";
import { createFakeApp } from "../testing/fakeApp";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u6372a_the_editor_group_lists_automatic_and_the_installed_editors_and_the_choice_rides_every_open", async () => {
  const app = createFakeApp();
  app.installedEditors = [{ id: "dev.zed.Zed", name: "Zed" }, { id: "com.apple.dt.Xcode", name: "Xcode" }];
  const opened = withAppSettings(app, () => false);

  render(() => <AppSettings app={app} project={() => "/p"} />);
  window.dispatchEvent(new Event("open-app-settings"));
  fireEvent.click(await screen.findByRole("tab", { name: "Editor" }));
  const panel = within(await screen.findByLabelText("Editor", { selector: '[role="tabpanel"]' }));
  const trigger = await waitFor(() => panel.getByLabelText("Code editor", { selector: "button" }));
  expect(trigger.textContent).toBe("Automatic");

  fireEvent.click(trigger);
  const list = within(await screen.findByLabelText("Code editor", { selector: '[role="listbox"]' }));
  expect(list.getAllByRole("option").map(option => option.textContent)).toEqual(["Automatic", "Zed", "Xcode"]);
  fireEvent.click(list.getByRole("option", { name: "Zed" }));
  await waitFor(() => expect(appSettings().codeEditor).toBe("dev.zed.Zed"));

  // A reload reads the stored record; the Project tab's seam carries the choice on every open.
  expect(JSON.parse(localStorage.getItem("roundup:app-settings")!)).toEqual({ codeEditor: "dev.zed.Zed" });
  await opened.openTarget({ kind: "path", path: "/p/a.ts", line: 3 });
  await opened.openInEditor("/p", undefined);
  expect(app.openedEditors).toEqual(["dev.zed.Zed"]);
  expect(app.editorCalls).toEqual([{ path: "/p", editor: "dev.zed.Zed" }]);
});
