import { defineConfig } from "vitest/config";
import desktop from "../vite.config";

export default defineConfig({
  ...desktop,
  test: { ...desktop.test, projects: undefined, include: ["reporting/results.fixture.test.ts"] },
});
