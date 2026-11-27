import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { appLog } from "../app/log";
import { notices } from "../testing/notices";
import { createMessageToast } from "../ink/messageToast";
import { createToastQueue } from "./queue";
import { Toasts } from "./Toasts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("u8004d_a_failure_without_a_user_start_logs_and_shows_nothing", () => {
  const lines: string[] = [];

  vi.spyOn(appLog, "write").mockImplementation(line => { lines.push(line); });

  const queue = createToastQueue(() => true, () => {});

  render(() => {
    createMessageToast({ started: false, message: "Could not read", dismiss: () => {} }, queue);
    createMessageToast({ started: true, message: "Could not save", dismiss: () => {} }, queue);

    return <Toasts queue={queue} />;
  });

  expect(notices("alert").map(each => each.textContent)).toEqual(["Could not save"]);
  expect(lines).toHaveLength(1);
});
