import { test, test as check, describe, vi, beforeAll, expect } from "vitest";
{ const test = (a, b, c) => {}; test("unrelated", () => {}, 90_000); }