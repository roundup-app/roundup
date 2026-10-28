import { test, test as check, describe, vi, beforeAll, expect } from "vitest";
defineConfig({ test: { ...externalOptions, testTimeout: 60_000 } });