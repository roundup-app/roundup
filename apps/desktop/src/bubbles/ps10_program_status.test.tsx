import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { Status } from "@contracts/Status";
import { event, info, NOW } from "../testing/nodes";
import { mountBubbles, TREE } from "./bubblesFixture";
import { statusText } from "../terminal/programStatus";

afterEach(cleanup);

const status = (kind: Status["kind"], label: string): Status => ({ kind, label, since: NOW, finished: "0" });

const tab = (id: string) => document.querySelector<HTMLElement>(`button.terminal-tab[data-bubble="${id}"]`)!;

const mount = (reported: Status | undefined) => {
  const terminal = info("1", { owner: "a", title: "cargo test" });

  if (reported) terminal.status = reported;

  return mountBubbles("a", [terminal], TREE);
};

it("ps10_a_terminal_row_shows_its_status_glyph_and_label_on_focus", async () => {
  await mount(status("needs-you", "Proceed? <b>y</b>"));

  await waitFor(() => expect(tab("1").querySelector("[data-program-status=needs-you] .glyph")).not.toBeNull());
  expect(tab("1").querySelector(".terminal-tab-label")).not.toBeNull();
  expect(tab("1").querySelector("b")).toBeNull();
  expect(tab("1").getAttribute("aria-label")).toBe("cargo test, Proceed? <b>y</b>");
});

it("ps10_an_empty_label_shows_the_kinds_word_and_null_shows_the_plain_tab", async () => {
  const m = await mount(status("error", ""));

  await waitFor(() => expect(tab("1").querySelector(".terminal-tab-label")).not.toBeNull());
  m.app.emit(event({ name: "terminal.status", data: { id: "1", status: null } }));
  await waitFor(() => expect(tab("1").querySelector(".terminal-tab-label")).toBeNull());
  expect(tab("1").getAttribute("aria-label")).toBe("cargo test");
});

it("ps10_a_label_is_text_with_direction_overrides_removed", () => {
  expect(statusText(status("done", "a‮b⁦c⁩d‪"))).toBe("abcd");
  expect(statusText(status("working", "<script>x</script>"))).toBe("<script>x</script>");
});

it("ps10_a_status_event_updates_the_row_and_a_burst_ends_in_the_last_state", async () => {
  const m = await mount(undefined);

  await waitFor(() => expect(tab("1")).not.toBeNull());
  expect(tab("1").querySelector(".glyph")).toBeNull();

  for (const [kind, label] of [["working", "one"], ["error", "two"], ["needs-you", "three"]] as const) m.app.emit(event({ name: "terminal.status", data: { id: "1", status: status(kind, label) } }));

  await waitFor(() => expect(tab("1").querySelector("[data-program-status]")!.getAttribute("data-program-status")).toBe("needs-you"));
});
