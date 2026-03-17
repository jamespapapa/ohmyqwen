import type { ZodType } from "zod";

function shouldValidateSnapshots(): boolean {
  return process.env.NODE_ENV === "test" || process.env.OHMYQWEN_VALIDATE_SNAPSHOTS === "1";
}

export function maybeValidateSnapshot<T>(schema: ZodType<T>, value: T): T {
  if (!shouldValidateSnapshots()) {
    return value;
  }
  return schema.parse(value);
}
