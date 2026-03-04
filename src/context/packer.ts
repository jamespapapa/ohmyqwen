import { SessionContext } from "../core/types.js";

export interface PackedContext {
  objective: string;
  shortSession: boolean;
  fileCount: number;
  focusFiles: string[];
}

export function packContext(ctx: SessionContext): PackedContext {
  return {
    objective: ctx.objective,
    shortSession: ctx.shortSession,
    fileCount: ctx.files.length,
    focusFiles: ctx.files.slice(0, 20)
  };
}
