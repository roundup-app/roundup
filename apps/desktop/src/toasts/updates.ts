import { createEffect } from "solid-js";
import * as v from "valibot";
import { storageSchema, storedValue } from "../state/storage";
import { PROGRAMS, type Updates } from "../state/updates";
import { copy } from "./copy";
import type { ToastQueue } from "./queue";

/** U7208e: the newest version of each program a Toast has named, so one version raises one Toast across looks and launches. */
const schema = storageSchema(
  "roundup:updates-told",
  v.object({ roundup: v.optional(v.string()), core: v.optional(v.string()) }),
);

const names = {
  roundup: copy.roundup,
  core: copy.herdrCore,
} as const;

/** U7208e: one Toast per ready version not yet told, whether the facts came at launch or from an hourly look; its card shows Settings on Updates. */
export const watchUpdates = (
  updates: Updates,
  notify: ToastQueue["notify"],
  saved = storedValue("roundup:updates-told", schema),
): void => {
  let told = saved.read() ?? {};

  createEffect(() => updates.facts(), (facts) => {
    if (!facts) return;

    const fresh = PROGRAMS.flatMap((program) => {
      const ready = facts[program]?.ready;

      return ready && told[program] !== ready ? [{ program, ready }] : [];
    });

    if (!fresh.length) return;

    told = {
      ...told,
      ...Object.fromEntries(fresh.map(({ program, ready }) => [program, ready])),
    };
    void saved.write(told);

    for (const { program, ready } of fresh) {
      const item = `updates:${program}:${ready}`;

      notify({
        key: item,
        item,
        kind: "done",
        name: copy.updateName(names[program], ready),
        line: copy.updateReady,
        selected: false,
        open: () => {
          updates.show();

          return null;
        },
      });
    }
  });
};
