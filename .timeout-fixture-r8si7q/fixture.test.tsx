import { test, test as check, describe, vi, beforeAll, expect } from "vitest";
defineConfig({ test: { testTimeout: 60_000, ...externalOptions } });