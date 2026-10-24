import { browser, read, wait } from "../ui/tabsBrowser";

export const journal = async (screen: string, reporting: boolean, program = false) => {
  await browser("eval", `(() => {
    const journal = [];
    window.__journal = journal;
    window.__emu.onInput(bytes => journal.push([...bytes]));
    if (${program}) return;
    window.__parsed = false;
    window.__emu.write(new TextEncoder().encode(${JSON.stringify("\x1b[2J\x1b[Halpha bravo charlie\r\n" + (reporting ? "\x1b[?1000h\x1b[?1006h" : "\x1b[?1000l\x1b[?1006l"))}), () => { window.__parsed = true; });
  })()`);

  if (!program) await wait("window.__parsed");

  return read<{ bytes: number[][]; selections: string[] }>(`(() => {
    const target = document.querySelector(${JSON.stringify(screen)});
    const box = target.getBoundingClientRect();
    const size = window.__emu.fit();
    const selections = [];
    const emit = (type, button, buttons, offset, ctrlKey = false, detail = 1) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: box.left + (offset / 10 + 0.5) * box.width / size.cols, clientY: box.top + 0.5 * box.height / size.rows, button, buttons, ctrlKey, detail });
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      target.dispatchEvent(event);
    };
    const click = (button, ctrl = false, distance = 0, detail = 1) => {
      emit('pointerdown', button, (button === 2 ? 2 : 1), 20, ctrl, detail);
      emit('mousedown', button, (button === 2 ? 2 : 1), 20, ctrl, detail);
      emit('pointermove', button, (button === 2 ? 2 : 1), 20 + distance, ctrl, detail);
      emit('mousemove', button, (button === 2 ? 2 : 1), 20 + distance, ctrl, detail);
      if(button === 2 || ctrl) emit('contextmenu', button, (button === 2 ? 2 : 1), 20, ctrl);
      emit('pointerup', button, 0, 20 + distance, ctrl, detail);
      emit('mouseup', button, 0, 20 + distance, ctrl, detail);
      selections.push(window.__emu.selection());
    };
    click(0, false, 80);
    click(0, false, 0, 2);
    emit('dblclick', 0, 0, 20, false, 2);
    selections.push(window.__emu.selection());
    click(2);
    click(0, true);
    click(2, false, 30);
    return { bytes: window.__journal, selections };
  })()`);
};
