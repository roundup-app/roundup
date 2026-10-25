import { copy } from "./copy";
import type { RailNode } from "@contracts/agent/RailNode";
import { isWorkstream, railOrder } from "../rail/layout";

export type Home = { home: string | null; name: string };

const PROJECT_ROOT = copy.projectRoot;

/** U158: a Workstream's current name from the Rail; the Project root for `null`, a Rail not yet loaded or an id the Rail does not hold — never the id. */
export const homeNameOf = (nodes: readonly RailNode[], home: string | null): string =>
  nodes.find((node) => node.id === home && isWorkstream(node))?.name ?? PROJECT_ROOT;

/** U157: the Project root, then each Workstream in Rail order, the current Home left out. */
export const homesToOffer = (nodes: readonly RailNode[], current: string | null): Home[] => {
  const workstreams = railOrder(nodes).filter(isWorkstream);
  const offers: Home[] = [{ home: null, name: PROJECT_ROOT }, ...workstreams.map((workstream) => ({ home: workstream.id, name: workstream.name }))];
  const present = nodes.some((node) => node.id === current && isWorkstream(node)) ? current : null;

  return offers.filter((offer) => offer.home !== present);
};
