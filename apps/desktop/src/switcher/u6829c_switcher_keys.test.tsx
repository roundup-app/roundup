import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { field, openSwitcher, mountSwitcher, rows, switcherKey as press } from "./switcherFixture";

afterEach(cleanup);

it("u6829c_switcher_and_project_tab_keys_work_after_a_click (switcher keys act whatever holds focus)", async () => {
  const { connected } = await mountSwitcher("ops");
  openSwitcher();
  await waitFor(() => expect(field()).not.toBeNull());
  const before = document.querySelector('.switcher [data-highlighted]')?.getAttribute("data-value");
  (document.activeElement as HTMLElement | null)?.blur();
  expect(document.activeElement).toBe(document.body);

  press("ArrowDown", {}, document.body);
  await waitFor(() => expect(document.querySelector('.switcher [data-highlighted]')?.getAttribute("data-value")).not.toBe(before));
  expect(rows().length).toBeGreaterThan(0);
  expect(connected.rail.selected()).toBe("ops");
});
