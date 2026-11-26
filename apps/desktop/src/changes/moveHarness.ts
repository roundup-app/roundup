import { vi } from "vitest";
import type { Moved, MoveRequest } from "./moves";

/** U7696: jsdom has no Worker. This stand-in answers each request from `worker.answer` and counts the Workers made and the requests sent. */
export const worker = { made: 0, requests: new Array<MoveRequest>(), answer: (_request: MoveRequest): readonly Moved[] | Promise<readonly Moved[]> => [] };

class Standin {
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor() { worker.made += 1; }

  postMessage({ id, ...request }: { id: number } & MoveRequest) {
    worker.requests.push(request);
    void Promise.resolve().then(() => worker.answer(request)).then(moved => this.onmessage?.({ data: { id, moved } }), (error: Error) => this.onmessage?.({ data: { id, cause: error.message } }));
  }

  terminate() {}
}

export const standInWorker = () => vi.stubGlobal("Worker", Standin);
