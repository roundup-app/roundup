import { copy } from "./copy";
import * as v from "valibot";
import { CONTRACT } from "@contracts/contract";
import type { AppSeam } from "./seam";

const daemonContract = v.safeParser(
  v.object({ contract: v.object({ fingerprint: v.string(), methods: v.optional(v.array(v.string())) }) }),
);

/** A `daemon.ping` answer; an older Daemon's carries no `contract`. */
type Pong = { pong: boolean; contract?: unknown };

/** What the Daemon reports of its contract; `null` when its ping carries none (built before A38). */
type ReportedContract = { fingerprint: string; methods?: string[] | undefined } | null;

/** Reads the contract out of a `daemon.ping` answer, which an older Daemon gives without one. */
const reportedContract = (pong: Pong): ReportedContract => {
  const parsed = daemonContract(pong);

  return parsed.success ? parsed.output.contract : null;
};

/** FNV-1a 64 over `parts`, each followed by a zero byte, as 16 hex digits; `fnv1a` of `crates/contracts`. */
const fnv1a = (parts: string[]): string => {
  const bytes = new TextEncoder().encode(parts.map((part) => `${part}\0`).join(""));
  const hash = bytes.reduce((acc, byte) => ((acc ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn, 0xcbf29ce484222325n);

  return hash.toString(16).padStart(16, "0");
};

/** The Contract fingerprint (A38) of method hashes by name: the same function as `fingerprint_of_hashes` in `crates/contracts`. */
export const contractFingerprint = (hashes: Readonly<Record<string, string>>): string =>
  fnv1a(
    Object.entries(hashes)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .flat(),
  );

/** The contract this webview was built with: the method names and the fingerprint, derived at load from the hashes `contract.ts` lists. */
export const OWN_CONTRACT = {
  fingerprint: contractFingerprint(CONTRACT.methods),
  methods: Object.keys(CONTRACT.methods).sort(),
};

const REMEDY = copy.quitAndRunJustAppAgainToRebuild;

/** S11: what the Daemon's `daemon.ping` answer says about its contract, set against the one this webview was built with. */
const contractNotice = (reported: ReportedContract): string | null => {
  if (!reported) return copy.theDaemonIsOlderThanTheApp(REMEDY);

  const { fingerprint, methods } = reported;

  if (fingerprint === OWN_CONTRACT.fingerprint) return null;

  if (!methods) return copy.theAppAndTheDaemonDiffer(REMEDY);

  const theirs = new Set(methods);
  const ours = new Set(OWN_CONTRACT.methods);
  const appHasMore = OWN_CONTRACT.methods.some((name) => !theirs.has(name));
  const daemonHasMore = methods.some((name) => !ours.has(name));

  if (appHasMore && !daemonHasMore) return copy.theDaemonIsOlderThanTheApp(REMEDY);

  if (daemonHasMore && !appHasMore) return copy.theDaemonIsNewerThanTheApp(REMEDY);

  return copy.theAppAndTheDaemonDiffer(REMEDY);
};

const forkColourOf = v.safeParser(v.object({ forkColour: v.picklist(["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"]) }));

/** U6044a: the root wears the colour of the Fork the Daemon runs on; a Daemon on the live data folder reports none, and the root keeps the live Tokens. */
const applyForkColour = (pong: Pong): void => {
  const parsed = forkColourOf(pong);

  if (parsed.success) document.documentElement.dataset.forkColour = parsed.output.forkColour;
  else delete document.documentElement.dataset.forkColour;
};

/** Asks the Project's Daemon once at connect; a failed ping says nothing here, since every later call fails and says why. The same answer sets the Fork colour on the root. */
export const checkContract = async (app: AppSeam): Promise<string | null> => {
  try {
    const pong = await app.rpc("daemon.ping", null);

    applyForkColour(pong);

    const reported = reportedContract(pong);

    if (!reported || reported.fingerprint === OWN_CONTRACT.fingerprint) return contractNotice(reported);

    // A38 before slim ping reported the names inline and has no daemon.methods.
    if (!reported.methods) {
      try {
        reported.methods = v.parse(v.array(v.string()), await app.rpc("daemon.methods", null));
      } catch {
        return contractNotice(reported);
      }
    }

    return contractNotice(reported);
  } catch {
    return null;
  }
};

/** S11: what the user reads for a `METHOD_NOT_FOUND` on `method`. */
export const methodNotFoundMessage = (method: string): string =>
  copy.theAppAndTheDaemonDiffer2(method, REMEDY);
