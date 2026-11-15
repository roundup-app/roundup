import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakeApp } from "../testing/fakeApp";
import { AppSettings } from "./AppSettings";
import { useBrowserStorage } from "../state/storage";
import { askOnce, isSuppressed } from "./warnings";

// Reopening the storage is the restart: the saved record is read again.
const restart = () => useBrowserStorage(window.localStorage);

beforeEach(() => { window.localStorage.clear(); restart(); });

afterEach(cleanup);

const question = { title: "Close?", message: "m", okLabel: "Close", cancelLabel: "Keep" };

const stub = (...answers: Array<boolean | { accepted: boolean; suppressed: boolean }>) => {
  const ask = vi.fn(async () => answers.shift() ?? true);

  return { app: { ask }, ask };
};

it("u7157c_a_suppressed_question_runs_its_action_without_asking", async () => {
  const { app, ask } = stub({ accepted: true, suppressed: true });

  expect(await askOnce(app, "close-terminal", question)).toBe(true);
  expect(ask).toHaveBeenCalledWith(expect.objectContaining({ suppressible: "Don't ask again" }));
  expect(await askOnce(app, "close-terminal", question)).toBe(true);
  expect(ask).toHaveBeenCalledTimes(1);
});

it("u7157c_suppressing_one_question_leaves_the_others_asking", async () => {
  const { app, ask } = stub({ accepted: true, suppressed: true });

  await askOnce(app, "close-terminal", question);
  await askOnce(app, "close-project", question);
  expect(ask).toHaveBeenCalledTimes(2);
});

it("u7157b_cancel_with_the_choice_ticked_records_nothing", async () => {
  const { app } = stub({ accepted: false, suppressed: true });

  expect(await askOnce(app, "close-terminal", question)).toBe(false);
  expect(isSuppressed("close-terminal")).toBe(false);
});

it("u7157c_the_choice_survives_a_restart_and_an_unreadable_record_asks", async () => {
  const { app, ask } = stub({ accepted: true, suppressed: true });

  await askOnce(app, "close-terminal", question);
  expect(JSON.parse(localStorage.getItem("roundup:app-settings") ?? "null").suppressed).toEqual(["close-terminal"]);
  localStorage.setItem("roundup:app-settings", JSON.stringify({ suppressed: ["close-terminal", "bogus", 4] }));
  restart();
  expect(isSuppressed("close-terminal")).toBe(true);
  expect(isSuppressed("close-project")).toBe(false);
  localStorage.setItem("roundup:app-settings", "not JSON");
  restart();
  expect(isSuppressed("close-terminal")).toBe(false);
  await askOnce(app, "close-terminal", question);
  expect(ask).toHaveBeenCalledTimes(2);
});

it("u7157d_reset_warnings_asks_every_question_again", async () => {
  const { app, ask } = stub({ accepted: true, suppressed: true });

  await askOnce(app, "close-terminal", question);
  render(() => <AppSettings app={createFakeApp()} project={() => "/p"} />);
  await Promise.resolve();
  window.dispatchEvent(new Event("open-app-settings"));
  await screen.findByLabelText("Settings", { selector: "section" });
  fireEvent.click(screen.getByText("Alerts", { selector: '[role="tab"]' }));
  const button = await screen.findByRole("button", { name: "Reset warnings" });

  expect(button.hasAttribute("disabled")).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(isSuppressed("close-terminal")).toBe(false));
  await askOnce(app, "close-terminal", question);
  expect(ask).toHaveBeenCalledTimes(2);
  expect(button.hasAttribute("disabled")).toBe(true);
});
