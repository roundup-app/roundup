import { copy } from "./copy";
import type { MoveReply } from "./moveWorker";
import type { Moved, MoveRequest } from "./moves";

type Waiting = { resolve: (moved: Moved[]) => void; reject: (error: Error) => void };

let worker: Worker | undefined;

let count = 0;

const waiting = new Map<number, Waiting>();

const start = () => {
  const made = new Worker(new URL("./moveWorker.ts", import.meta.url), { type: "module" });

  made.onmessage = ({ data }: MessageEvent<MoveReply>) => {
    const reply = waiting.get(data.id);

    waiting.delete(data.id);

    if ("moved" in data) reply?.resolve(data.moved); else reply?.reject(new Error(data.cause));
  };

  // A Worker that failed to start answers nothing: every read waiting on it fails, and the next read starts a new one.
  made.onerror = event => {
    for (const reply of waiting.values()) reply.reject(new Error(event.message || copy.moveReaderStopped));
    waiting.clear();
    made.terminate();

    if (worker === made) worker = undefined;
  };

  return made;
};

/** U7696b: reads one file's moved and renamed code in a Worker that starts at the first read, so no grammar loads before a Logic item draws a file. */
export const readMoves = (request: MoveRequest) => new Promise<Moved[]>((resolve, reject) => {
  worker ??= start();
  count += 1;
  waiting.set(count, { resolve, reject });
  worker.postMessage({ id: count, ...request });
});
