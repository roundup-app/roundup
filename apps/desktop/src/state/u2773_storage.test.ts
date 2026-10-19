import * as v from "valibot";
import { afterEach, expect, it, vi } from "vitest";
import { storedValue } from "./storage";

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

it("u2773e_storage_failure_keeps_memory_distinguishes_missing_from_invalid", () => {
  const storage = storedValue("draft", v.string());
  expect(storage.restore()).toEqual({ status: "missing" });
  localStorage.setItem("draft", "{broken");
  expect(storage.restore()).toEqual({ status: "failed", cause: "invalid" });
  expect(localStorage.getItem("draft")).toBe("{broken");
  expect(storage.read()).toBeNull();
});
