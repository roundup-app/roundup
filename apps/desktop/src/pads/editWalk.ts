type Run = (...args: string[]) => Promise<string>;

const walk = ".pad-body [data-walk]";

/** PW11, PW12: a Pad with text opens as its walk. These agent-browser steps press Edit when a walk shows and wait for the editor to take input; a Pad that opens in Edit needs none of them. */
export const editSteps: string[][] = [
  ["wait", "--fn", `!!document.querySelector("${walk}, .pad-body .ProseMirror[contenteditable=true]")`],
  ["eval", `(() => { const walk = document.querySelector("${walk}"); walk?.closest(".pad-body").querySelector(".pad-head [data-button=primary]").click(); return walk !== null; })()`],
  ["wait", "--fn", `!document.querySelector("${walk}") && !!document.querySelector(".pad-body .ProseMirror[contenteditable=true]")`],
];

export const editWalk = async (run: Run) => {
  for (const step of editSteps) await run(...step);
};
