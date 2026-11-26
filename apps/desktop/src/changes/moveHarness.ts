import { vi } from "vitest";
import type { Moved, MoveRequest } from "./moves";

/** U7696: jsdom has no Worker. This stand-in answers each request from `reads.answer` and counts the Workers made and the requests sent. */
export const reads = { made: 0, requests: new Array<MoveRequest>(), answer: (_request: MoveRequest): readonly Moved[] | Promise<readonly Moved[]> => [] };

class Standin {
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor() { reads.made += 1; }

  postMessage({ id, ...request }: { id: number } & MoveRequest) {
    reads.requests.push(request);
    void Promise.resolve().then(() => reads.answer(request)).then(moved => this.onmessage?.({ data: { id, moved } }), (error: Error) => this.onmessage?.({ data: { id, cause: error.message } }));
  }

  terminate() {}
}

export const standInReader = () => vi.stubGlobal("Worker", Standin);
