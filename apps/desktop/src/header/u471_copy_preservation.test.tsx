import { questionDialog } from "../shelf/bulkQuestionHarness";
import { createFakeApp } from "../testing/fakeApp";
import { ToastHost } from "../testing/toastHost";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { Tabs } from "../ui/Tabs";
import { Strip } from "./Strip";
import type { StripTab } from "./tab";

afterEach(cleanup);

it("u497_copy_preserves_authored_values_project_name_and_agents", async () => {
  const name = "Ünï “quoted” 雪";
  const tab: StripTab = { path: "/tmp/with space/雪", name, exitText: null, busy: false, causes: [], needsYou: 0, error: 0, running: ["Agent «Ünï»"] };
  render(() => <ToastHost><Tabs.Root value={tab.path} ids={{ trigger: () => "authored-tab" }}><Strip app={createFakeApp()} tabs={[tab]} active={tab.path} onSelect={() => {}} onMark={() => {}} onRename={(path, name) => Promise.resolve({ path, name, revision: 0, status: "failed" as const, error: "unused rename" })} onClose={() => {}} onReorder={() => {}} alerts={{ level: () => "all", set: () => {} }} onChoose={() => {}} /></Tabs.Root></ToastHost>);

  fireEvent.click(screen.getByLabelText(`Close ${name}`));
  expect((await questionDialog()).message).toContain("Agent «Ünï»");
});
