import { toBase64 } from "./base64";
import type { Emulator } from "./emulator";

/** An emulator reply of `OK` to a Kitty graphics command. */
const isKittyOk = (text: string): boolean => text.startsWith("\x1b_G") && text.endsWith("\x1b\\") && /^i=\d+;OK$/.test(text.slice(3, -2));

/** Tauri may run two `rpc` calls out of order, so at most one write is in flight; what is typed meanwhile goes as one write. */
export const createTyping = (emulator: Emulator, write: (data: string) => Promise<boolean>) => {
  let typed: number[] = [];
  let writing = false;

  const flush = async (): Promise<void> => {
    writing = true;

    try {
      while (typed.length > 0) {
        const batch = typed;

        emulator.inputEncoding?.(batch);

        const data = toBase64(Uint8Array.from(typed));

        typed = [];
        emulator.inputEncoded?.(batch);
        await write(data);
      }
    } finally {
      writing = false;
    }
  };

  return (bytes: Uint8Array, userInput: boolean): void => {
    // U5984: the Daemon answers a Kitty query in stream order, ahead of DA1; the emulator's own `OK` would reach the program twice.
    if (!userInput && isKittyOk(String.fromCharCode(...bytes))) return;

    for (const byte of bytes) typed.push(byte);

    if (!writing) void flush();
  };
};
