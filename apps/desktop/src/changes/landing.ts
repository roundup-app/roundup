import { createEffect, createMemo, untrack } from "solid-js";
import { moduleKey } from "./ChangedTree";
import { OVERVIEW } from "./lens";

type Landing = {
  signature: () => string;
  rows: () => readonly string[];
  modules: () => readonly { name: string }[];
  viewedKeys: () => ReadonlySet<string>;
  picked: () => string | undefined;
  setPicked: (key: string) => void;
};

// U8010a: with no item chosen, the landing is the first item not viewed, else the first item, else the lens's empty state (the Overview pane); it follows the marks until an item is chosen, and a chosen item wins over it.
export const createLanding = (input: Landing) => {
  const landed = createMemo(() => {
    input.signature();
    const viewed = input.viewedKeys();

    return untrack(() => {
      if (input.rows().length === 0) return undefined;

      const keys = input.modules().map(module => moduleKey(module.name));

      return keys.find(key => !viewed.has(key)) ?? keys[0] ?? OVERVIEW;
    });
  });

  // U7675c: the landing becomes the chosen item, so one that leaves the listing is told as it is.
  createEffect(() => ({ chosen: input.picked(), landing: landed() }), ({ chosen, landing }) => { if (chosen === undefined && landing !== undefined && landing !== OVERVIEW) input.setPicked(landing); });

  // U7674a, U8010a: what shows is the chosen item still listed, or the Overview pane, else the landing.
  return () => {
    const chosen = input.picked();
    const listed = chosen === OVERVIEW ? input.rows().length > 0 : chosen !== undefined && input.rows().includes(chosen);

    return listed ? chosen : landed();
  };
};
