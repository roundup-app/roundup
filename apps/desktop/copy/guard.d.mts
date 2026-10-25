export function checkCopy(files: Record<string, string>, glossary?: string, options?: { ownershipOnly?: boolean }): { file: string; rule: string; identity: string | number; text: string }[];
