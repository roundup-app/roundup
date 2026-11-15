import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { NativeAlert } from "./NativeAlert";
import { questionKeys, type QuestionKey } from "../settings/preferences";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBrowserStorage } from "../state/storage";
import { askOnce, isSuppressed } from "../settings/warnings";

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


it.each(questionKeys)("u7157b_each_question_carries_an_unticked_dont_ask_again_choice_%s", async (key: QuestionKey) => {
  // A native question the system cannot show falls back into the App, where the choice is a checkbox.
  const ask = vi.fn(async () => { throw new Error("no native alert"); });
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  render(() => <NativeAlert app={{ ask }} open key={key} question={question} onConfirm={onConfirm} onCancel={onCancel} finalFocus={() => null} />);
  const choice = await screen.findByRole<HTMLInputElement>("checkbox", { name: "Don't ask again" });

  expect(ask).toHaveBeenCalledWith(expect.objectContaining({ suppressible: "Don't ask again" }));
  expect(choice.checked).toBe(false);
  fireEvent.click(choice);
  await waitFor(() => expect(choice.checked).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "Keep" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
  expect(isSuppressed(key)).toBe(false);
});

it("u7157b_the_choice_ticked_in_the_app_question_and_confirmed_suppresses_it", async () => {
  const ask = vi.fn(async () => { throw new Error("no native alert"); });
  const onConfirm = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  render(() => <NativeAlert app={{ ask }} open key="close-project" question={question} onConfirm={onConfirm} onCancel={() => undefined} finalFocus={() => null} />);
  const choice = await screen.findByRole<HTMLInputElement>("checkbox", { name: "Don't ask again" });
  fireEvent.click(choice);
  await waitFor(() => expect(choice.checked).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  expect(isSuppressed("close-project")).toBe(true);
});
