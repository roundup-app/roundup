import * as v from "valibot";
import { CONTRACT } from "@contracts/contract";
import type { AppSeam } from "./seam";

const daemonContract = v.safeParser(
  v.object({ contract: v.object({ fingerprint: v.string(), methods: v.array(v.string()) }) }),
);

/** A `daemon.ping` answer; an older Daemon's carries no `contract`. */
type Pong = { pong: boolean; contract?: unknown };

/** What the Daemon reports of its contract; `null` when its ping carries none (built before A38). */
type ReportedContract = { fingerprint: string; methods: string[] } | null;

/** Reads the contract out of a `daemon.ping` answer, which an older Daemon gives without one. */
const reportedContract = (pong: Pong): ReportedContract => {
  const parsed = daemonContract(pong);

  return parsed.success ? parsed.output.contract : null;
};

const REMEDY = "Quit and run `just app` again to rebuild it.";

/** S11: what the Daemon's `daemon.ping` answer says about its contract, set against the one this webview was built with. */
const contractNotice = (reported: ReportedContract): string | null => {
  if (!reported) return `The Daemon is older than the App. ${REMEDY}`;

  const { fingerprint, methods } = reported;

  if (fingerprint === CONTRACT.fingerprint) return null;

  const theirs = new Set(methods);
  const ours = new Set<string>(CONTRACT.methods);
  const appHasMore = CONTRACT.methods.some((name) => !theirs.has(name));
  const daemonHasMore = methods.some((name) => !ours.has(name));

  if (appHasMore && !daemonHasMore) return `The Daemon is older than the App. ${REMEDY}`;

  if (daemonHasMore && !appHasMore) return `The Daemon is newer than the App. ${REMEDY}`;

  return `The App and the Daemon differ. ${REMEDY}`;
};

/** Asks the Project's Daemon once at connect; a failed ping says nothing here, since every later call fails and says why. */
export const checkContract = async (app: AppSeam): Promise<string | null> => {
  try {
    return contractNotice(reportedContract(await app.rpc("daemon.ping", null)));
  } catch {
    return null;
  }
};

/** S11: what the user reads for a `METHOD_NOT_FOUND` on `method`. */
export const methodNotFoundMessage = (method: string): string =>
  `${method}: the App and the Daemon differ. ${REMEDY}`;
