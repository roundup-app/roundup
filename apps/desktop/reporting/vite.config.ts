import { mergeConfig } from "vitest/config";
import desktop from "../vite.config";

export default mergeConfig(desktop, {
  test: { include: ["reporting/results.fixture.ts"] },
});
