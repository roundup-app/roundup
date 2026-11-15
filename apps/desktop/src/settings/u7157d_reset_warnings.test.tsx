import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakeApp } from "../testing/fakeApp";
import { AppSettings } from "./AppSettings";
import { useBrowserStorage } from "../state/storage";
import { askOnce, isSuppressed } from "./warnings";

beforeEach(() => { window.localStorage.clear(); useBrowserStorage(window.localStorage); });

afterEach(cleanup);

const question = { title: "Close?", message: "m", okLabel: "Close", cancelLabel: "Keep" };

const stub = (...answers: Array<boolean | { accepted: boolean; suppressed: boolean }>) => {
  const ask = vi.fn(async () => answers.shift() ?? true);

  return { app: { ask }, ask };
};

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
