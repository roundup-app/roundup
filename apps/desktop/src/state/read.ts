import { createMemo, createSignal, isPending } from "solid-js";

type Answer<Reply> = { reply?: Awaited<Reply> | undefined; error?: Error | undefined };

/** One Daemon read that no reader waits on: `reply` is its newest answer, kept through a later read or failure, and `error` its newest failure, which an answer after it clears. A read asked for again replaces the one in flight, and `pending` holds while it is out beside an earlier answer; a `source` of `false` asks nothing. */
export const createReply = <Args, Reply>(source: () => Args | false, fetch: (args: Args) => Promise<Reply>) => {
  const [asked, ask] = createSignal(0);

  // `loadingValue` makes the first read answer nothing instead of suspending its reader.
  const read = createMemo<Answer<Reply>>(async (previous): Promise<Answer<Reply>> => {
    asked();
    const args = source();

    if (args === false) return {};

    try {
      return { reply: await fetch(args) };
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      return { reply: previous.reply, error: thrown };
    }
  }, { loadingValue: {} });

  return { reply: () => read().reply, error: () => read().error, pending: () => isPending(read), refetch: () => { ask(count => count + 1); } };
};
