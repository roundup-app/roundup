import { animate } from "motion";

const EASE_OUT: [number, number, number, number] = [0.32, 0.72, 0, 1];

/** Runs `change` and eases the rows it moved or added from where they were drawn: M5's 200 ms layout, 150 ms opacity under reduced motion. */
export const foldLayout = (scope: HTMLElement | undefined, reduced: boolean, change: () => void) => {
  const tops = (): Map<HTMLElement, number> => new Map([...(scope?.querySelectorAll<HTMLElement>(".rail-row[data-id]") ?? [])].map(row => [row, row.getBoundingClientRect().top]));
  const byId = (rows: Map<HTMLElement, number>) => new Map([...rows].map(([row, top]) => [row.dataset.id, top]));
  const before = byId(tops());

  change();

  // The rows are measured where the folded list put them; the slide starts after that, from where each was drawn.
  queueMicrotask(() => {
    for (const [row, top] of tops()) {
      const was = before.get(row.dataset.id);

      if (was === undefined) animate(row, { opacity: [0, 1] }, { duration: reduced ? 0.15 : 0.2, ease: EASE_OUT });
      else if (!reduced && Math.abs(was - top) >= 0.5) animate(row, { translate: [`0px ${was - top}px`, "0px 0px"] }, { duration: 0.2, ease: EASE_OUT });
      else if (reduced && Math.abs(was - top) >= 0.5) animate(row, { opacity: [0.6, 1] }, { duration: 0.15 });
    }
  });
};
