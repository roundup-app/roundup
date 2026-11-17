/** T21: an Agent's comment shows one line; a closed `For Agents` fold may follow it. */
export const agentCommentLine = (body: string): string => body.replace(/\n[\s\S]*/, "");
