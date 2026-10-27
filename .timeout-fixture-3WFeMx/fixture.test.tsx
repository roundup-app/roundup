import { test, test as check, describe, vi, beforeAll, expect } from "vitest";
const a = b; const b = a; test("t3779a_cycle", () => {}, a);