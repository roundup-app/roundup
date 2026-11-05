import { afterEach, expect, it, vi } from "vitest";
import { ESC, kitty, open } from "./imageHarness";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const asked = async (query: string) => {
  const { write, replies, settle } = open();

  await write(query);
  await settle();

  return replies;
};

const mode = (code: number, set: string) => `${ESC}[?${code}${set}`;

const report = (code: number, state: number) => `${ESC}[?${code};${state}$y`;

// The Daemon (`crates/terminal/src/scheme.rs`, `status.rs`) answers these in stream order, so the emulator adds nothing: a second reply, or one in another voice, would reach the program too.
it.each([
  ["xtversion", `${ESC}[>q`],
  ["da1", `${ESC}[c`],
  ["osc_11", `${ESC}]11;?${ESC}\\`],
  ["osc_7501", `${ESC}]7501;?${ESC}\\`],
  // The emulator reports no cell size and obeys no Kitty keyboard flags, so it does not claim either.
  ["csi_16_t", `${ESC}[16t`],
  ["kitty_keyboard", `${ESC}[?u`],
])("u6146_%s_reply_matches_the_emulator", async (_name, query) => {
  expect(await asked(query)).toEqual([]);
});

it.each([2026, 1016])("u6146_decrpm_%i_reply_matches_the_emulator", async (code) => {
  const { write, replies, settle } = open();

  await write(`${ESC}[?${code}$p`);
  await write(mode(code, "h"));
  await write(`${ESC}[?${code}$p`);
  await write(mode(code, "l"));
  await write(`${ESC}[?${code}$p`);
  await settle();
  // Reset, set, reset: the emulator implements both modes.
  expect(replies).toEqual([report(code, 2), report(code, 1), report(code, 2)]);
});

it("u6145_the_emulator_answers_each_medium", async () => {
  const unsupported = `${ESC}_Gi=1;EINVAL:unsupported transmission medium${ESC}\\`;

  for (const medium of ["f", "t", "s"]) expect(await asked(kitty(`i=1,s=1,v=1,a=q,t=${medium},f=24`, "AAAA"))).toEqual([unsupported]);

  // The direct medium is read: its `OK` is the emulator's, and the Screens drop it for the Daemon's, which comes first.
  expect(await asked(kitty("i=1,s=1,v=1,a=q,t=d,f=24", "AAAA"))).toEqual([`${ESC}_Gi=1;OK${ESC}\\`]);
});
