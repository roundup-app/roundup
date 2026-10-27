import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../App";
import { mountNavigation } from "../testing/navigationFixture";
import { createFakeApp } from "../testing/fakeApp";
import { agent, info } from "../testing/nodes";
import { leaderArmed, endLeader } from "./registry";

const draft = "  unfinished work 🐈\nexact  ";
const press = (code: string, options: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { code, key: code === "Slash" ? "/" : code.replace("Key", "").toLowerCase(), bubbles: true, cancelable: true, ...options });
  document.activeElement!.dispatchEvent(event);
  return event;
};

afterEach(() => { cleanup(); endLeader(); localStorage.clear(); });

const chords = ["agent", "prompt", "terminal", "capture", "leader", "ask", "help"] as const;
const places = ["rail", "centre", "agent-terminal", "bubble", "shelf", "triage", "ask", "first-control", "first-frame"] as const;

it.each(chords.flatMap(chord => places.map(place => ({ chord, place }))))("u4324b_app_chords_follow_focus: $chord / $place", async ({ chord, place }) => {
  const first = place.startsWith("first");
  const fixture = first ? null : await mountNavigation();
  const app = fixture?.app ?? createFakeApp();
  const chooser = vi.spyOn(app, "chooseProjectPath");
  if (first) render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  const daemon = fixture?.daemon ?? app;
  const calls = (method: string) => daemon.calls.filter(call => call.method === method);
  daemon.handlers["agent.spawn"] = () => agent("new", "idle", "ready");
  daemon.handlers["terminal.open"] = () => { fixture?.shells.push(info("shell", { owner: "home" })); return { terminal_id: "shell" }; };
  let target: HTMLElement;
  if (first) {
    target = await screen.findByRole("button", { name: "Choose folder…" });
    if (place === "first-frame") target = document.querySelector<HTMLElement>(".centre")!;
  } else {
    const editor = screen.getByRole("textbox", { name: "Ask" });
    fireEvent.input(editor, { target: { value: draft } });
    if (place !== "ask") fixture!.connected().rail.select("home");
    if (place === "agent-terminal") {
      fixture!.connected().rail.select("a1");
      await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a1"));
      target = document.activeElement as HTMLElement;
    } else if (place === "bubble") {
      fixture!.shells.push(info("existing", { owner: "home" }));
      await fixture!.connected().rail.refresh({ terminals: true });
      fireEvent.click(await screen.findByRole("button", { name: /existing/ }));
      await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("existing"));
      target = document.activeElement as HTMLElement;
    } else if (place === "shelf" || place === "triage") {
      press("KeyK", { metaKey: true }); press("KeyS");
      if (place === "triage") fireEvent.click(await screen.findByRole("button", { name: "Triage" }));
      target = await screen.findByRole("button", { name: /Selected work/ });
    } else target = place === "ask" ? editor : document.querySelector<HTMLElement>(place === "rail" ? '.rail-row[data-id="home"]' : ".centre")!;
  }
  target.tabIndex = -1;
  target.focus();
  expect(document.activeElement).toBe(target);
  const selected = fixture?.connected().rail.selected();
  const event = chord === "help" ? press("Slash", { key: "?", shiftKey: true })
    : chord === "ask" ? press("Slash", { metaKey: true })
    : chord === "leader" ? press("KeyK", { metaKey: true })
    : press(chord === "agent" || chord === "prompt" ? "KeyN" : "KeyT", { metaKey: true, shiftKey: chord === "prompt" || chord === "capture" });
  const excludedHelp = chord === "help" && ["agent-terminal", "bubble", "ask"].includes(place);
  if (chord === "help") {
    if (excludedHelp) { expect(event.defaultPrevented).toBe(false); expect(screen.queryByRole("dialog")).toBeNull(); }
    else {
      await screen.findByRole("dialog", { name: "Help" });
      await waitFor(() => expect(document.activeElement).toBe(document.querySelector(".help")));
      press("Escape", { key: "Escape" });
      await waitFor(() => expect(document.activeElement).toBe(target));
      expect(fixture?.connected().rail.selected()).toBe(selected);
    }
  } else if (first) {
    if (chord === "capture") await waitFor(() => expect(chooser).toHaveBeenCalledTimes(1));
    expect(calls("agent.spawn")).toHaveLength(0);
    expect(calls("terminal.open")).toHaveLength(0);
    expect(leaderArmed()).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  } else if (chord === "agent") await waitFor(() => expect(calls("agent.spawn")).toHaveLength(1));
  else if (chord === "terminal") await waitFor(() => expect(calls("terminal.open")).toHaveLength(1));
  else if (chord === "prompt" || chord === "capture") {
    const field = await screen.findByRole("textbox", { name: chord === "capture" ? "Capture a Todo" : "Task" });
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(calls("agent.spawn")).toHaveLength(0);
    expect(calls("todo.create")).toHaveLength(0);
  } else if (chord === "leader") {
    expect(leaderArmed()).toBe(true);
    expect(document.activeElement).toBe(target);
    press("KeyS");
    expect(leaderArmed()).toBe(false);
  } else await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Ask" })));
  if (!first && !excludedHelp) expect(event.defaultPrevented).toBe(true);
  expect(calls("terminal.write")).toHaveLength(0);
  expect(calls("ask.send")).toHaveLength(0);
  if (fixture) expect(fixture.connected().drafts.list().some(record => record.destination.surface === "ask" && record.value.text === draft)).toBe(true);
});
