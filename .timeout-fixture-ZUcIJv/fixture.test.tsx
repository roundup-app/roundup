import { test, test as check, describe, vi, beforeAll, expect } from "vitest";
defineConfig({ ...externalOptions, test: { testTimeout: 60_000 } });