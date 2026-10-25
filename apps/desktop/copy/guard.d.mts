export interface Violation { rule: string; identity: string; branch: string; fingerprint: string }

export interface Diagnostic extends Violation { file: string; text: string; message: string }

export function checkCopy(files: Record<string, string>, options?: { rules?: string[]; root?: string; glossary?: string; baseline?: Violation[]; previous?: Violation[] }): { inventory: Violation[]; diagnostics: Diagnostic[] };
