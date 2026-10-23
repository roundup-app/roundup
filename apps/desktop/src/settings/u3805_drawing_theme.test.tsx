import { fireEvent, waitFor } from "@solidjs/testing-library";
import { createElement, useState } from "react";
import { afterEach, expect, it } from "vitest";
import { mountDrawing } from "../pads/drawingBlock";
import type { CanvasApi } from "../pads/drawingBlock";
import { saveAppSettings } from "./preferences";

let release: (() => void) | undefined;

let host: HTMLDivElement;

afterEach(async () => {
  release?.();
  await Promise.resolve();
  host?.remove();
  localStorage.clear();
});

it("u3805_open_drawings_receive_the_app_theme_without_replacing_their_editor", async () => {
  // CanvasApi is the foreign seam; the production mount and React root own updates and editor identity.
  const themes: string[] = [];

  const canvas: CanvasApi = {
    convertToExcalidrawElements: () => [],
    restoreElements: () => [],
    Excalidraw: props => {
      const [draft, setDraft] = useState("");
      themes.push(props.theme);

      return createElement("input", { value: draft, onChange: event => setDraft(event.currentTarget.value), "aria-label": "Drawing input" });
    },
  };

  host = document.body.appendChild(document.createElement("div"));
  release = mountDrawing(canvas)(host, { text: '{"type":"excalidraw","elements":[]}', readonly: false, replace: () => {} });
  await waitFor(() => expect(host.querySelector("input")).toBeTruthy());
  const input = host.querySelector("input")!;
  fireEvent.input(input, { target: { value: "unfinished shape" } });
  saveAppSettings({ mode: "dark" });
  await waitFor(() => expect(themes.at(-1)).toBe("dark"));
  saveAppSettings({ mode: "light" });
  await waitFor(() => expect(themes.at(-1)).toBe("light"));
  expect(host.querySelector("input")).toBe(input);
  expect(input.value).toBe("unfinished shape");
});
