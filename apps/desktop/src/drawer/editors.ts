import type { JSX } from "solid-js";
import type { TodosState } from "../todos/state";

type TodoCreation = (props: { recovery: { project: string; revision: string; list: TodosState } }) => JSX.Element;

let todoCreation: TodoCreation | null = null;

export const todoCreationEditor = { get: () => todoCreation, set: (editor: TodoCreation) => { todoCreation = editor; } };
