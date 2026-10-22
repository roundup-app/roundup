import type { AppSeam } from "../app/seam";
import { copy } from "../copy";

/** DV5: resolve one published Deliverable by its exact identity and open what it names. Resolves the unavailable cause, never another target's content, or `null` once it opened. */
export const openDeliverable = async (app: AppSeam, project: string, id: string): Promise<string | null> => {
  const resolved = await app.rpc("deliverable.resolve", { project, id });

  if (resolved.kind === "unavailable") return copy.deliverableUnavailable[resolved.cause];

  if (resolved.kind === "external" && !/^https?:\/\//i.test(resolved.url)) return copy.deliverableUnsafe;

  await app.openTarget(resolved.kind === "external"
    ? { kind: "url", url: resolved.url }
    : { kind: "path", path: resolved.path, line: null });

  return null;
};
