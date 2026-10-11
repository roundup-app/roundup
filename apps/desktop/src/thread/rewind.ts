import { createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { Checkpoint } from "@contracts/checkpoint/Checkpoint";
import type { Files } from "@contracts/workstream/Files";
import type { RewindPlan } from "@contracts/workstream/RewindPlan";
import type { Events } from "../app/events";
import type { AppSeam } from "../app/seam";

/** The prompt U374 opens under one Checkpoint: `plan` is null until the Daemon answers. */
export type RewindPrompt = { checkpoint: number; plan: RewindPlan | null; failure: string | null };

export type Rewind = {
  prompt: Accessor<RewindPrompt | null>;
  pending: Accessor<boolean>;
  /** The Checkpoint the Workstream was last taken back to. */
  rewoundTo: Accessor<number | null>;
  isRewindable(checkpoint: Checkpoint): boolean;
  open(checkpoint: number): void;
  close(): void;
  run(choice: { files: Files; takeover: readonly string[] }): void;
};

/** U374: the one rewind of the Workstream's Thread: plan, prompt, call and result. Another Workstream's events are not its own. */
export const createRewind = (app: AppSeam, events: Events, workstream: Accessor<string>): Rewind => {
  const [prompt, setPrompt] = createSignal<RewindPrompt | null>(null);
  const [pending, setPending] = createSignal(false);
  const [rewoundTo, setRewoundTo] = createSignal<number | null>(null);

  const finish = (checkpoint: number) => {
    setRewoundTo(checkpoint);
    setPending(false);
    setPrompt(null);
  };

  onCleanup(
    events.subscribe((event) => {
      if (event.name === "workstream.rewound" && event.data.id === workstream()) finish(event.data.checkpoint);
    }),
  );

  const open = (checkpoint: number) => {
    const mine = workstream();

    setPrompt({ checkpoint, plan: null, failure: null });
    app.rpc("workstream.rewindPlan", { id: mine, checkpoint }).then(
      (plan) => setPrompt((now) => (now?.checkpoint === checkpoint ? { checkpoint, plan, failure: null } : now)),
      (thrown) => {
        if (!(thrown instanceof Error)) throw thrown;

        const failure = thrown.message;

        setPrompt((now) => (now?.checkpoint === checkpoint ? { ...now, failure } : now));
      },
    );
  };

  const run = (choice: { files: Files; takeover: readonly string[] }) => {
    const now = prompt();

    if (!now || pending()) return;

    setPending(true);
    setPrompt({ ...now, failure: null });

    const call = async () => {
      const proof = choice.takeover.length > 0 ? await app.daemonProof() : undefined;

      const params = { id: workstream(), checkpoint: now.checkpoint, files: choice.files, takeover: [...choice.takeover] };

      await app.rpc("workstream.rewind", proof === undefined ? params : { ...params, proof });
    };

    call().then(
      () => finish(now.checkpoint),
      (thrown) => {
        if (!(thrown instanceof Error)) throw thrown;

        const failure = thrown.message;

        setPending(false);
        setPrompt((current) => (current ? { ...current, failure } : current));
      },
    );
  };

  return {
    prompt,
    pending,
    rewoundTo,
    // A rewind makes every later Checkpoint stale before the next list says so.
    isRewindable: (checkpoint) => checkpoint.rewindable && (rewoundTo() === null || checkpoint.id <= rewoundTo()!),
    open,
    close: () => {
      if (!pending()) setPrompt(null);
    },
    run,
  };
};
