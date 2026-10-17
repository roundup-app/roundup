import { render, screen } from "@solidjs/testing-library";
import type { ModelList } from "@contracts/project/ModelList";
import type { ProjectSettings } from "@contracts/project/ProjectSettings";
import { createFakeApp } from "../testing/fakeApp";
import { NOW } from "../testing/nodes";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { ModelsSheet } from "./ModelsSheet";

export const LIST: ModelList = {
  models: [{ id: "m-opus", label: "Opus" }, { id: "m-sonnet", label: "Sonnet" }],
  efforts: [{ id: "e-low", label: "Low" }, { id: "e-high", label: "High" }],
};

export const settings = (roles: string[]): ProjectSettings => ({
  worktrees: { on: false, check: null },
  mcp: { on: true },
  models: { roles: roles.map((role) => ({ role, model: null, effort: null })) },
});

/** The `Models` sheet on a fake Daemon whose `project.get` answers `get` and `models.list` answers `list`. */
export const mountSheet = async (get: ProjectSettings, list: ModelList = LIST, onClose: () => void = () => {}) => {
  const app = createFakeApp();
  app.handlers["project.get"] = () => get;
  app.handlers["models.list"] = () => list;
  app.handlers["project.setModels"] = () => null;
  app.handlers["project.setMcp"] = () => null;

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => NOW);

  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <ModelsSheet onClose={onClose} />
    </ConnectedProjectContext.Provider>
  ));

  return { app };
};

/** The select named `label`, once it renders. */
export const selectNamed = async (label: string): Promise<HTMLSelectElement> => {
  const found = await screen.findByRole("combobox", { name: label });

  if (!(found instanceof HTMLSelectElement)) throw new Error(`${label} is no select`);

  return found;
};

export const checkboxNamed = (label: string): HTMLInputElement => {
  const found = screen.getByLabelText(label);

  if (!(found instanceof HTMLInputElement)) throw new Error(`${label} is no checkbox`);

  return found;
};

export const buttonNamed = (name: string): HTMLButtonElement => {
  const found = screen.getByRole("button", { name });

  if (!(found instanceof HTMLButtonElement)) throw new Error(`${name} is no button`);

  return found;
};
