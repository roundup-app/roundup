import type { JSX } from "solid-js";
import type { TodosState } from "../todos/state";

type TodoEditor = (props: { id: number; todos: TodosState; recovery: { project: string; revision: string } }) => JSX.Element;

let todo: TodoEditor | null = null;

/** The Todo editor renders the recovery entry, so the panel reaches it here instead of importing it. */
export const todoEditor = { get: () => todo, set: (editor: TodoEditor) => { todo = editor; } };
