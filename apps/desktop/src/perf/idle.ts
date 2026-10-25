/** R24: timestamps are renderer monotonic milliseconds, separate from native receipt time. */
export type IdleEvidence = {
  seq: number;
  at_ms: number;
  cause: "initial" | "selection" | "renderer" | "visibility" | "focus" | "resize" | "collection-lost";
  visibility: DocumentVisibilityState;
  focused: boolean;
  project: string | null;
  terminal: string | null;
  renderer: "webgl" | "dom" | null;
  width: number;
  height: number;
};

export const createIdleEvidence = (doc: Document, view: Window, now: () => number, send: (record: IdleEvidence) => Promise<void>) => {
  let seq = 0;
  let project: string | null = null;
  let terminal: string | null = null;
  const renderers = new Map<string, IdleEvidence["renderer"]>();
  let pending = 0;
  let failure: string | null = null;
  let stopped = false;
  let tail = Promise.resolve();

  const snapshot = (cause: IdleEvidence["cause"]): IdleEvidence => ({
    seq: ++seq, at_ms: now(), cause, visibility: doc.visibilityState, focused: doc.hasFocus(), project, terminal,
    renderer: terminal === null ? null : renderers.get(terminal) ?? null,
    width: view.innerWidth, height: view.innerHeight,
  });

  const emit = (cause: IdleEvidence["cause"]) => {
    if (stopped || failure !== null) return;

    const overflow = pending >= 256;

    if (overflow) failure = "R24 renderer evidence queue overflow";

    const record = snapshot(overflow ? "collection-lost" : cause);

    pending += 1;
    tail = tail.then(() => send(record)).catch(error => { failure = String(error); }).finally(() => { pending -= 1; });
  };

  const visibility = () => emit("visibility");
  const focus = () => emit("focus");
  const resize = () => emit("resize");
  const lost = () => emit("collection-lost");

  doc.addEventListener("visibilitychange", visibility);
  view.addEventListener("focus", focus);
  view.addEventListener("blur", focus);
  view.addEventListener("resize", resize);
  view.addEventListener("pagehide", lost);
  emit("initial");

  return {
    selected(path: string | null, id: string | null) {
      project = path;
      terminal = id;
      emit("selection");
    },
    renderer(webgl: boolean, id: string) {
      if (renderers.size >= 256 && !renderers.has(id)) {
        emit("collection-lost");
        stopped = true;

        return;
      }

      renderers.set(id, webgl ? "webgl" : "dom");
      emit("renderer");
    },
    checkpoint() { return { seq, pending, error: failure }; },
    async flush() {
      await tail;

      if (failure !== null) throw new Error(failure);
    },
    stop() {
      stopped = true;
      doc.removeEventListener("visibilitychange", visibility);
      view.removeEventListener("focus", focus);
      view.removeEventListener("blur", focus);
      view.removeEventListener("resize", resize);
      view.removeEventListener("pagehide", lost);
    },
  };
};
