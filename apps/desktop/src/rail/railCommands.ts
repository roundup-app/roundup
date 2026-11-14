import PQueue from "p-queue";
import { applying } from "../app/pending";
import type { Applied } from "../app/pending";
import { RpcError } from "../app/seam";
import type { RailState } from "../state/rail";

const NOT_FOUND = -32001;

/** The Daemon no longer holds what the call named, so a fresh read answers it. */
export const isNotFound = (error: Error): boolean =>
  error instanceof RpcError && error.code === NOT_FOUND;

/** One command a Rail row, key or menu starts. */
export type RailCommand<R> = {
  call: () => Promise<R>;
  /** U5991a: shows the change at once; the returned call lifts it when the command ends. */
  draw?: () => () => void;
  /** The row a failure is about; an applied command clears a failure about it. */
  item?: string;
  /** Names the command in its failure line. */
  label?: string;
  retry?: () => void;
  /** Reads the Terminals with the tree once the call applied. */
  terminals?: boolean;
  /** Settles a call with no answer, which the Daemon may still apply, in place of a failure line. */
  unknown?: (error: Error) => Promise<void>;
};

/** Whether a refusal earns a failure line: an `AbortError` is a launch the user dropped, and a `NOT_FOUND` is answered by the tree read back. */
export const showsFailure = (error: Error): boolean =>
  error.name !== "AbortError" && !isNotFound(error);

/** U5991a: draws the row, calls the Daemon, reads the tree back and lifts the row; a refusal comes back unshown for a caller that settles its own draft. A non-Error rethrows. */
export const applyCommand = async <R>(
  rail: RailState,
  command: RailCommand<R>,
): Promise<Applied<R>> => {
  const lift = command.draw?.();

  try {
    const outcome = await applying(command.call);

    if (outcome.kind === "applied") {
      await rail.refresh(command.terminals ? { terminals: true } : undefined);
      rail.commandFailure.acknowledge(command.item ?? null);
    } else if (!(outcome.thrown instanceof Error)) throw outcome.thrown;
    else if (isNotFound(outcome.error)) await rail.refresh();

    return outcome;
  } finally {
    lift?.();
  }
};

/** U5172a, U5991a: the one place a Rail command draws its row, calls the Daemon, reads the tree back, then clears or shows its failure. */
export const railCommand = async <R>(
  rail: RailState,
  command: RailCommand<R>,
): Promise<Applied<R>> => {
  const outcome = await applyCommand(rail, command);

  if (outcome.kind === "applied" || !showsFailure(outcome.error))
    return outcome;

  if (outcome.kind === "pending" && command.unknown)
    await command.unknown(outcome.error);
  else {
    const message =
      command.label === undefined
        ? outcome.error.message
        : `${command.label}: ${outcome.error.message}`;

    rail.commandFailure.show(
      message,
      command.item ?? null,
      "rail",
      command.retry ?? null,
    );
  }

  return outcome;
};

type Launched = { terminal_id: string | null };

type Preparation = NonNullable<
  Awaited<ReturnType<NonNullable<RailState["prepareTerminal"]>>>
>;

/** U6000d: the launches of one Rail reach the Daemon in the order fired. A job ends when its call is sent, so a launch waits for the earlier ones to be sent, never to be answered, and one that fails holds none back. */
export const createLaunch = (rail: RailState) => {
  const sending = new PQueue({ concurrency: 1 });

  return async <T extends Launched>(
    send: (size?: Preparation["size"]) => Promise<T>,
  ): Promise<T> => {
    // SAFETY: no timeout is set, so `add` resolves with the job's result, never `void`.
    const { prepared, reply } = (await sending.add(async () => {
      const prepared = await rail.prepareTerminal?.();

      return { prepared, reply: send(prepared?.size) };
    })) as {
      prepared: Preparation | undefined;
      reply: Promise<T>;
    };

    try {
      const launched = await reply;

      if (launched.terminal_id) prepared?.bind(launched.terminal_id);

      return launched;
    } finally {
      prepared?.dispose();
    }
  };
};
