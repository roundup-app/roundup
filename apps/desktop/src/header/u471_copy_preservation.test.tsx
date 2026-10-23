import { questionDialog } from "../shelf/bulkQuestionHarness";
import { createFakeApp } from "../testing/fakeApp";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { Tabs } from "../ui/Tabs";
import { Strip } from "./Strip";
import type { StripTab } from "./tab";

afterEach(cleanup);

const mount = () => {
  const tab: StripTab = { path: "/tmp/lowercase", name: "lowercase", exitText: null, busy: false, needsYou: 1, error: 0, running: ["agent name"] };

  render(() => <Tabs.Root value={tab.path} ids={{ trigger: () => "copy-project-tab" }}><Strip app={createFakeApp()} tabs={[tab]} active={tab.path} onSelect={() => {}} onMark={() => {}} onRename={async (path, name) => ({ path, name, revision: 0, status: "failed", error: "unused rename" })} onClose={() => {}} onChoose={() => {}} /></Tabs.Root>);
};

it("u471_previous_copy_assertions_are_preserved_header_labels_use_sentence_case_and_preserve_project_names", () => {
  mount();

  expect(screen.getByRole("tablist", { name: "Projects" })).toBeTruthy();
  expect(screen.getByRole("tab").hasAttribute("title")).toBe(false);
  expect(screen.getByRole("tab").textContent).toBe("lowercase");
  expect(screen.getByRole("img", { name: "Needs you" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open a folder" })).toBeTruthy();
  expect(screen.getByLabelText("Close lowercase")).toBeTruthy();
});

it("u471_previous_copy_assertions_are_preserved_header_rename_label_keeps_the_glossary_capital", async () => {
  mount();
  screen.getByRole("tab").focus();
  fireEvent.keyDown(screen.getByRole("tab"), { key: "F2" });

  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Project name" }).value).toBe("lowercase");
});

it("u497_copy_preserves_authored_values_project_name_and_agents", async () => {
  const name = "Ünï “quoted” 雪";
  const tab: StripTab = { path: "/tmp/with space/雪", name, exitText: null, busy: false, needsYou: 0, error: 0, running: ["Agent «Ünï»"] };
  render(() => <Tabs.Root value={tab.path} ids={{ trigger: () => "authored-tab" }}><Strip app={createFakeApp()} tabs={[tab]} active={tab.path} onSelect={() => {}} onMark={() => {}} onRename={async (path, name) => ({ path, name, revision: 0, status: "failed", error: "unused rename" })} onClose={() => {}} onChoose={() => {}} /></Tabs.Root>);

  expect(screen.getByRole("tab").textContent).toBe(name);
  fireEvent.click(screen.getByLabelText(`Close ${name}`));
  expect((await questionDialog()).message).toContain("Agent «Ünï»");
});
