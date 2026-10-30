import { beforeAll, afterAll, vi, expect, it } from "vitest";
import { age } from "./Age";

beforeAll(() => vi.stubEnv("TZ", "America/New_York"));
afterAll(() => vi.unstubAllEnvs());
// Use local constructors to exercise the App local calendar date.
const changed = new Date(2026, 8, 12, 12).getTime();
it.each([
  [-1, "now"], [59, "now"], [60, "1m"], [300, "5m"],
  [3599, "59m"], [3600, "1h"], [7200, "2h"], [86399, "23h"],
  [86400, "1d"], [518400, "6d"], [604799, "6d"], [604800, "1w"],
  [1814400, "3w"], [2419199, "3w"], [2419200, "2026-09-12"],
])("u4709a_age_boundaries_%s", (seconds, expected) => {
  expect(age(changed, changed + seconds * 1000)).toBe(expected);
});

it("u4709a_calendar_date_uses_local_time", () => {
  const changed = Date.UTC(2026, 8, 12, 2);
  expect(age(changed, Date.UTC(2026, 9, 30))).toBe("2026-09-11");
});
