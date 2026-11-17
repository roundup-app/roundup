import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { Actor } from "@contracts/Actor";
import type { Comment } from "@contracts/todo/Comment";
import { agent } from "../testing/nodes";
import { mountTodos, todo } from "./testHarness";

afterEach(cleanup);

const panel = () => screen.getByRole("complementary", { name: "Drawer" });

const AGENT: Actor = { kind: "agent", id: "a", parent: null };

const USER_ACTOR: Actor = { kind: "user", id: "you", parent: null };

const line = (id: number, author: Actor, body: string): Comment => ({ id, author, body, created_at: id * 60_000, read: true });

const one = (root: ParentNode, selector: string): Element => {
  const found = root.querySelector(selector);

  if (!found) throw new Error(`no ${selector}`);

  return found;
};

const open = async () => {
  const row = await screen.findByRole("button", { name: /^Idle #1 / });
  row.focus();
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  await within(panel()).findByRole("region", { name: "Activity" });
};

// Q10: each of these must stay text, in the fold's label and in its body.
const unsafe = '<script>window.u7312a = 1</script> <img src=x onerror="window.u7312a = 1"> [go](javascript:alert(1))';

const body = ["**Shipped** the fix.", "", "| Lane | Time |", "|---|---|", "| web | 4 min |", "", `<details><summary>For Agents ${unsafe}</summary>`, "", `Run \`just check\` first. ${unsafe}`, "", "</details>"].join("\n");

it("u7312a_an_agent_comment_renders_markdown_and_a_closed_fold", async () => {
  const m = await mountTodos([todo(1)], true, [agent("a", "idle", "Idle", { name: "builder" })]);
  m.store.comments?.set(1, [line(1, AGENT, body), line(2, USER_ACTOR, "**mine** <b>raw</b>")]);
  await open();
  // The Drawer holds the only thread, so the rows are found by their ids.
  await waitFor(() => expect(document.querySelector("[data-comment='1'] strong")).not.toBeNull());

  const theirs = one(document, "[data-comment='1']");
  expect(theirs.querySelectorAll("table td")).toHaveLength(2);

  const fold = one(theirs, "details");
  expect(fold.hasAttribute("open")).toBe(false);
  expect(fold.querySelector("code")).not.toBeNull();
  expect(one(fold, "summary").textContent).toMatch(/For Agents <script>window\.u7312a/);
  expect(theirs.querySelector("script, img, [onerror], a")).toBeNull();
  expect("u7312a" in window).toBe(false);

  // The user's own comment stays as typed.
  const mine = one(document, "[data-comment='2']");
  expect(mine.querySelector("strong, b")).toBeNull();
  expect(mine.textContent).toMatch(/\*\*mine\*\* <b>raw<\/b>/);
});
