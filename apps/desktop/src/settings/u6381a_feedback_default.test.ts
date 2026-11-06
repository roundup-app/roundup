import { afterEach, expect, it } from "vitest";
import { appSettings, saveAppSettings } from "./preferences";

const LIVE = "https://github.com/roundup-app/roundup/issues/6163";

afterEach(() => localStorage.clear());

it("u6381a_a_fresh_app_targets_the_live_feedback_issue_and_a_saved_value_stays", async () => {
  expect(appSettings().feedbackIssue).toBe(LIVE);

  await saveAppSettings({ feedbackIssue: "https://github.com/o/r/issues/3" });
  expect(appSettings().feedbackIssue).toBe("https://github.com/o/r/issues/3");

  await saveAppSettings({ feedbackIssue: "" });
  expect(appSettings().feedbackIssue).toBe("");
});
