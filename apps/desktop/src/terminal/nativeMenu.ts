import { makeEventListener } from "@solid-primitives/event-listener";
import type { Terminal } from "@xterm/xterm";

/** Look Up and the right-press guard for an opened `terminal`. Its listeners belong to the calling reactive owner. */
export const attachNativeMenu = (terminal: Terminal, root: HTMLElement): void => {
  // xterm's native-menu handler selects its editable input. WebKit needs a DOM
  // range in non-editable text to offer Look Up and Services without Cut/Font.
  const menuText = document.createElement("span");

  menuText.className = "terminal-menu-text";
  menuText.setAttribute("aria-hidden", "true");
  root.append(menuText);

  // xterm's reporting handler sends a right press even when its selection service
  // preserves the selection. Stop that press before it can reach the program.
  makeEventListener(root, "mousedown", (event) => {
    if (event.button !== 2 || terminal.modes.mouseTrackingMode === "none") return;

    const selection = terminal.getSelectionPosition();

    if (!selection) return;

    const screen = root.querySelector<HTMLElement>(".xterm-screen");

    if (!screen) return;

    const box = screen.getBoundingClientRect();
    const col = Math.floor((event.clientX - box.left) * terminal.cols / box.width);
    const row = Math.floor((event.clientY - box.top) * terminal.rows / box.height);
    const line = row + terminal.buffer.active.viewportY;
    const afterStart = line > selection.start.y || (line === selection.start.y && col >= selection.start.x);
    const beforeEnd = line < selection.end.y || (line === selection.end.y && col < selection.end.x);

    if (col >= 0 && col < terminal.cols && row >= 0 && row < terminal.rows && afterStart && beforeEnd) event.stopImmediatePropagation();
  }, true);

  makeEventListener(root, "contextmenu", (event) => {
    event.stopPropagation();
    menuText.textContent = terminal.getSelection();
    menuText.style.left = `${event.clientX}px`;
    menuText.style.top = `${event.clientY}px`;
    const range = document.createRange();

    range.selectNodeContents(menuText);
    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  }, true);
};
