import { createEffect, createSignal, onCleanup } from "solid-js";
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

  let generation = 0;
  createEffect(() => {
    workstream();
    generation++;
    setPrompt(null);
    setPending(false);
    setRewoundTo(null);
  });
  onCleanup(() => { generation++; });

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
    const request = ++generation;

    setPrompt({ checkpoint, plan: null, failure: null });
    app.rpc("workstream.rewindPlan", { id: mine, checkpoint }).then(
      (plan) => setPrompt((now) => (request === generation && mine === workstream() && now?.checkpoint === checkpoint ? { checkpoint, plan, failure: null } : now)),
      (thrown) => {
        if (!(thrown instanceof Error)) throw thrown;

        const failure = thrown.message;

        setPrompt((now) => (request === generation && mine === workstream() && now?.checkpoint === checkpoint ? { ...now, failure } : now));
      },
    );
  };

  const run = (choice: { files: Files; takeover: readonly string[] }) => {
    const now = prompt();

    if (!now || pending()) return;

    const mine = workstream();
    const request = generation;
    setPending(true);
    setPrompt({ ...now, failure: null });

    const call = async () => {
      const proof = choice.takeover.length > 0 ? await app.daemonProof() : undefined;

      const params = { id: mine, checkpoint: now.checkpoint, files: choice.files, takeover: [...choice.takeover] };

      await app.rpc("workstream.rewind", proof === undefined ? params : { ...params, proof });
    };

    call().then(
      () => { if (request === generation && mine === workstream()) finish(now.checkpoint); },
      (thrown) => {
        if (!(thrown instanceof Error)) throw thrown;

        const failure = thrown.message;

        if (request !== generation || mine !== workstream()) return;
        setPending(false);
        setPrompt((current) => (current ? { ...current, failure } : current));
      },
    );
  };

  return {
    prompt,
    pending,
    rewoundTo,
    isRewindable: (checkpoint) => checkpoint.rewindable,
    open,
    close: () => {
      if (!pending()) setPrompt(null);
    },
    run,
  };
};
