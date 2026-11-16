import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import { INTERNAL_CODE, RpcError, type UpdateFacts } from "../app/seam";
import { createUpdates, UpdatesProvider } from "../state/updates";
import { useBrowserStorage } from "../state/storage";
import { createFakeApp } from "../testing/fakeApp";
import { AppSettings } from "./AppSettings";
import { copy } from "./copy";

beforeEach(() => {
  window.localStorage.clear();
  useBrowserStorage(window.localStorage);
});

afterEach(cleanup);

const BOTH_READY: UpdateFacts = {
  roundup: { version: "0.4.0", ready: "0.5.0" },
  core: { version: "0.1.21", ready: "0.1.22" },
};

/** Settings on a fake App that holds `facts`; the App opens it as the application menu does. */
const mount = async (facts: UpdateFacts, page?: "updates") => {
  const app = createFakeApp();

  app.updateFacts = facts;
  render(() => (
    <UpdatesProvider value={createUpdates(app)}>
      <AppSettings app={app} project={() => "/p"} />
    </UpdatesProvider>
  ));
  await Promise.resolve();
  window.dispatchEvent(new CustomEvent("open-app-settings", { detail: page }));
  await screen.findByLabelText("Settings", { selector: "section" });

  return app;
};

const row = (name: string) => within(screen.getByRole("group", { name }));

const button = (name: string) => row(name).queryAllByRole("button");

it("u7208a_updates_page_shows_both_rows_with_their_state", async () => {
  const app = await mount(BOTH_READY, "updates");
  const tab = screen.getByRole("tab", { name: copy.settingsUpdates });

  expect(tab.getAttribute("aria-selected")).toBe("true");
  expect(
    await row(copy.roundup).findByText(copy.updateName(copy.roundup, "0.4.0")),
  ).toBeTruthy();
  expect(
    row(copy.roundup).getByText(copy.updateReady("0.5.0", copy.settingsAgents)),
  ).toBeTruthy();
  expect(button(copy.roundup)).toHaveLength(1);
  expect(
    row(copy.herdrCore).getByText(
      copy.updateReady("0.1.22", copy.updateKeepsTerminals),
    ),
  ).toBeTruthy();
  expect(button(copy.herdrCore)).toHaveLength(1);
  expect(screen.getByText(copy.updatesFootnote)).toBeTruthy();

  app.emitUpdates({ roundup: { version: "0.5.0", ready: null }, core: null });
  await waitFor(() =>
    expect(row(copy.roundup).getByText(copy.upToDate)).toBeTruthy(),
  );
  expect(button(copy.roundup)).toHaveLength(0);
  expect(row(copy.herdrCore).getByText(copy.updateNotFound)).toBeTruthy();
  expect(button(copy.herdrCore)).toHaveLength(0);

  app.emitUpdates({ roundup: null, core: { version: "0.1.22", ready: null } });
  await waitFor(() =>
    expect(screen.queryByRole("group", { name: copy.roundup })).toBeNull(),
  );
  expect(row(copy.herdrCore).getByText(copy.upToDate)).toBeTruthy();
  expect(screen.queryByText(copy.updatesFootnote)).toBeNull();
});

it("u7208a_search_finds_each_update_row_with_its_button", async () => {
  await mount(BOTH_READY);
  const search = await screen.findByRole("searchbox");

  fireEvent.input(search, { target: { value: "herdr-core" } });
  expect(
    await screen.findByRole("button", { name: copy.updateCore }),
  ).toBeTruthy();
  expect(
    screen.queryAllByRole("button", { name: copy.updateRoundup }),
  ).toHaveLength(0);

  fireEvent.input(search, { target: { value: "roundup" } });
  expect(
    await screen.findByRole("button", { name: copy.updateRoundup }),
  ).toBeTruthy();
});

it("u7208b_a_failed_install_shows_its_cause_and_keeps_the_button", async () => {
  const app = await mount(BOTH_READY, "updates");
  const press = await screen.findByRole("button", { name: copy.updateRoundup });
  const cutOff = new RpcError(INTERNAL_CODE, "the download was cut off");
  let installs = 0;
  let finish!: () => void;

  app.installUpdate = () => {
    installs += 1;

    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  };

  fireEvent.click(press);
  await waitFor(() => expect(press.getAttribute("aria-busy")).toBe("true"));
  expect(installs).toBe(1);

  finish();
  await waitFor(() => expect(press.matches("[aria-busy]")).toBe(false));

  app.installUpdate = async () => {
    installs += 1;

    throw cutOff;
  };

  fireEvent.click(press);
  expect(await row(copy.roundup).findByText(cutOff.message)).toBeTruthy();
  expect(installs).toBe(2);
  expect(press.matches("[aria-busy]")).toBe(false);
  expect(
    row(copy.roundup).getByText(copy.updateReady("0.5.0", copy.settingsAgents)),
  ).toBeTruthy();
});

it("u7208b_a_pending_install_shows_updating_and_its_progress_and_ignores_a_second_click", async () => {
  const app = await mount(BOTH_READY, "updates");
  const press = await screen.findByRole("button", { name: copy.updateRoundup });
  let finish!: () => void;

  app.updateGate = new Promise<void>((resolve) => { finish = resolve; });
  fireEvent.click(press);
  fireEvent.click(press);
  await waitFor(() => expect(press.getAttribute("aria-busy")).toBe("true"));
  expect(screen.getByRole("button", { name: "Updating…" })).toBe(press);
  expect(app.updateInstalls).toBe(1);

  const mb = 1_000_000;

  app.emitUpdateProgress({ downloaded: 12 * mb, total: 40 * mb, stage: "downloading" });
  // U7208b: the row counts megabytes come and megabytes in all, never a percent.
  const line = await screen.findByText(copy.updateDownloading(12 * mb, 40 * mb));

  expect(line.textContent?.match(/\d+/g)?.map(Number)).toEqual([12, 40]);
  app.emitUpdateProgress({ downloaded: 40_000_000, total: 40_000_000, stage: "installing" });
  expect(await screen.findByText(copy.updateInstalling)).toBeTruthy();

  finish();
  await waitFor(() => expect(press.matches("[aria-busy]")).toBe(false));
  expect(screen.queryByText(copy.updateInstalling)).toBeNull();
  expect(screen.getByRole("button", { name: copy.updateRoundup })).toBe(press);
});

it("u7208c_a_pending_core_update_shows_updating_and_ignores_a_second_click", async () => {
  const app = await mount(BOTH_READY, "updates");
  const press = await screen.findByRole("button", { name: copy.updateCore });
  let finish!: () => void;

  app.updateGate = new Promise<void>((resolve) => { finish = resolve; });
  fireEvent.click(press);
  fireEvent.click(press);
  await waitFor(() => expect(press.getAttribute("aria-busy")).toBe("true"));
  expect(screen.getByRole("button", { name: "Updating…" })).toBe(press);
  expect(app.coreUpdates).toBe(1);

  finish();
  await waitFor(() => expect(screen.queryByRole("button", { name: copy.updateCore })).toBeNull());
});

it("u7208c_the_core_row_shows_the_new_version_or_the_failure", async () => {
  const app = await mount(BOTH_READY, "updates");
  const noSpace = new RpcError(INTERNAL_CODE, "no space left on device");

  app.coreUpdateFailure = noSpace;
  fireEvent.click(await screen.findByRole("button", { name: copy.updateCore }));
  expect(await row(copy.herdrCore).findByText(noSpace.message)).toBeTruthy();
  expect(
    row(copy.herdrCore).getByRole("button", { name: copy.updateCore }),
  ).toBeTruthy();
  expect(
    row(copy.herdrCore).getByText(copy.updateName(copy.herdrCore, "0.1.21")),
  ).toBeTruthy();

  app.coreUpdateFailure = null;
  fireEvent.click(
    row(copy.herdrCore).getByRole("button", { name: copy.updateCore }),
  );
  expect(
    await row(copy.herdrCore).findByText(
      copy.updateName(copy.herdrCore, "0.1.22"),
    ),
  ).toBeTruthy();
  expect(row(copy.herdrCore).getByText(copy.upToDate)).toBeTruthy();
  expect(button(copy.herdrCore)).toHaveLength(0);
  expect(screen.queryByText(noSpace.message)).toBeNull();
  expect(app.coreUpdates).toBe(2);
});

it("u7208f_the_updates_payload_shows_the_updates_page", async () => {
  await mount(BOTH_READY);
  fireEvent.click(await screen.findByRole("tab", { name: "Terminal" }));
  fireEvent.input(await screen.findByRole("searchbox"), {
    target: { value: "font" },
  });
  await screen.findByRole("list", { name: "Search results" });

  window.dispatchEvent(
    new CustomEvent("open-app-settings", { detail: "updates" }),
  );
  expect(
    await screen.findByRole("button", { name: copy.updateRoundup }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("tab", { name: copy.settingsUpdates })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(screen.getByRole("searchbox")).toHaveProperty("value", "");
});
