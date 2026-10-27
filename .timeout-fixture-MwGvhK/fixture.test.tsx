import { test, test as check, describe, vi, beforeAll, expect } from "vitest";
beforeAll(() => {}, 90_000); expect.poll(() => 1, { timeout: 90_000 }).toBe(1);