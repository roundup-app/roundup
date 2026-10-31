import { afterEach, expect, it } from "vitest";
import { runSwitchWorkload, summarize } from "./switch_run";

it("sp4_summary_discards_the_warm_up_and_ranks_by_nearest_rank", () => {
  const all = [...Array.from({ length: 10 }, () => 900), ...Array.from({ length: 100 }, (_, index) => index + 1)];

  expect(summarize(all, 10, 3)).toEqual({ n: 100, dropped: 3, p50: 50, p95: 95, p99: 99, max: 100 });
});

const listeners: ((event: KeyboardEvent) => void)[] = [];

afterEach(() => {
  listeners.splice(0).forEach((handler) => document.removeEventListener("keydown", handler));
  document.querySelector(".switcher")?.remove();
});

const fakeSwitcher = (values: string[]) => {
  const keys: string[] = [];
  const picked: string[] = [];
  let leader = false;

  const close = () => document.querySelector(".switcher")?.remove();

  const handler = (event: KeyboardEvent) => {
    keys.push(event.key === "k" && event.metaKey ? "chord-leader" : event.key);

    if (event.key === "k" && event.metaKey) leader = true;
    else if (event.key === "k" && leader) {
      leader = false;
      document.body.insertAdjacentHTML("beforeend", `<div class="switcher"><input />${values.map((value) => `<div class="app-combobox-item" data-value="${value}"></div>`).join("")}</div>`);
      document.querySelector(".app-combobox-item")?.setAttribute("data-highlighted", "");
    } else if (event.key === "ArrowDown") {
      const list = [...document.querySelectorAll(".app-combobox-item")];
      const now = list.findIndex((item) => item.hasAttribute("data-highlighted"));

      list[now]?.removeAttribute("data-highlighted");
      list[(now + 1) % list.length]?.setAttribute("data-highlighted", "");
    } else if (event.key === "Enter") {
      picked.push(document.querySelector(".app-combobox-item[data-highlighted]")?.getAttribute("data-value") ?? "");
      close();
    } else if (event.key === "Escape") close();
  };

  document.addEventListener("keydown", handler);
  listeners.push(handler);

  return { keys, picked };
};

const deps = (probe: Parameters<typeof runSwitchWorkload>[0]["probe"]) => ({ probe, sleep: async () => {}, random: () => 0, until: async () => {} });

const counting = () => {
  let opens = 0;
  let switches = 0;

  return { samples: () => ({ open: Array.from({ length: opens }, () => 1), switch: Array.from({ length: switches }, () => 1) }), dropped: () => ({ open: 0, switch: 0 }), bump: (kind: "open" | "switch") => (kind === "open" ? (opens += 1) : (switches += 1)) };
};

it("sp4_the_loops_press_the_chord_then_escape_and_enter_onto_alternating_kinds", async () => {
  const fake = fakeSwitcher(["action:x", "agent:a1", "terminal:t1", "agent:a2", "terminal:t2"]);
  const counts = counting();

  const count = (event: KeyboardEvent) => {
    if (event.key === "Escape") counts.bump("open");

    if (event.key === "Enter") counts.bump("switch");
  };

  document.addEventListener("keydown", count);
  listeners.push(count);

  const report = await runSwitchWorkload(deps(counts));

  expect(fake.keys.slice(0, 3)).toEqual(["chord-leader", "k", "Escape"]);
  expect(fake.picked.length).toBe(110);
  expect(fake.picked.slice(0, 4).map((value) => value.split(":")[0])).toEqual(["agent", "terminal", "agent", "terminal"]);
  expect(report.switcher_open).toMatchObject({ n: 100, dropped: 0 });
  expect(report.switch).toMatchObject({ n: 100, dropped: 0 });
});

it("sp4_a_project_without_a_terminal_fails_the_run_instead_of_shortening_it", async () => {
  fakeSwitcher(["agent:a1"]);

  await expect(runSwitchWorkload(deps(counting()))).rejects.toThrow(/no terminal/);
});
