/** The id a group's collapse is saved under, beside the Workstream ids (U100, U172). */
export type GroupId = "rail:workstreams" | "shelf:todos" | "shelf:pads";

/** A saved id that is no `GroupId` and no Workstream is dropped on restore. */
export const isGroupId = (id: string): id is GroupId => id === "rail:workstreams" || id === "shelf:todos" || id === "shelf:pads";
