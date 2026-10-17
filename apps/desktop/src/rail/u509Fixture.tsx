import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import type { ModelList } from "@contracts/project/ModelList";
import { createFakeApp } from "../testing/fakeApp";
import { AddAgentPicker } from "./AddAgentPicker";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";
import "./styles.css";

const dense = new URLSearchParams(location.search).has("dense");

const list: ModelList = dense
  ? { models: Array.from({ length: 20 }, (_, at) => ({ id: `m${at}`, label: `Model ${at} ${"長い名前".repeat(2)} ${"x".repeat(24)}` })), efforts: [{ id: "e1", label: "Low" }, { id: "e2", label: "High" }] }
  : { models: [{ id: "m-opus", label: "Opus" }, { id: "m-sonnet", label: "Sonnet" }], efforts: [{ id: "e1", label: "Low" }, { id: "e2", label: "High" }] };

const failing = new URLSearchParams(location.search).has("fail");

const app = createFakeApp();

app.handlers["project.get"] = () => failing ? Promise.reject(new Error(`Could not read the Project settings ${"x".repeat(40)}`)) : ({ worktrees: { on: false, check: null }, mcp: { on: true }, models: { roles: [{ role: "subagent", model: null, effort: null }] } });

const Fixture = () => {
  const [pair, setPair] = createSignal<{ model: string | null; effort: string | null }>({ model: null, effort: null });
  const [adds, setAdds] = createSignal(0);
  const [closes, setCloses] = createSignal(0);
  const [disabled, setDisabled] = createSignal(false);
  Object.assign(window, { __form: { pair, adds, closes, setDisabled } });

  return <div class="rail" style={{ width: "280px" }}>
    <AddAgentPicker app={app} list={list} pair={pair()} disabled={disabled()} onChange={setPair} onAdd={() => setAdds((n) => n + 1)} onClose={() => setCloses((n) => n + 1)} />
  </div>;
};

render(() => <Fixture />, document.getElementById("root")!);
