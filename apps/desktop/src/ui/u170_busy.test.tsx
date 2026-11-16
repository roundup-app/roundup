import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { BusyButton } from "./BusyButton";

afterEach(cleanup);

const BUSY = ["Adding", "…"].join("");

const mount = (onClick: () => Promise<void>) => {
  render(() => <BusyButton kind="add" busyLabel="Adding…" onClick={onClick}>Add</BusyButton>);

  return screen.getByRole("button", { name: "Add" });
};

it("u170_busy_a_pending_click_shows_the_busy_label_and_ignores_a_second_click", async () => {
  const work = vi.fn(() => new Promise<void>(() => {}));
  const press = mount(work);

  fireEvent.click(press);
  fireEvent.click(press);
  await waitFor(() => expect(press.getAttribute("aria-busy")).toBe("true"));
  expect(screen.getByRole("button", { name: BUSY })).toBe(press);
  expect(work).toHaveBeenCalledTimes(1);
});

it("u170_busy_the_settled_promise_restores_the_idle_label", async () => {
  let settle!: (outcome: "ok" | "fail") => void;
  const press = mount(() => new Promise<void>((resolve, reject) => { settle = (outcome) => outcome === "ok" ? resolve() : reject(new Error("no")); }));

  fireEvent.click(press);
  await waitFor(() => expect(press.getAttribute("aria-busy")).toBe("true"));
  settle("fail");
  await waitFor(() => expect(press.matches("[aria-busy]")).toBe(false));
  expect(screen.getByRole("button", { name: "Add" })).toBe(press);

  fireEvent.click(press);
  settle("ok");
  await waitFor(() => expect(press.matches("[aria-busy]")).toBe(false));
});
