/** Keep Zag's machine intact while an owner supplies its permitted focus actions. */
export const focusActions = <M extends { implementations?: { actions?: object | undefined } | undefined }>(
  machine: M,
  actions: Partial<NonNullable<NonNullable<M["implementations"]>["actions"]>>,
): M => ({
  ...machine,
  implementations: {
    ...machine.implementations,
    actions: { ...machine.implementations?.actions, ...actions },
  },
});
