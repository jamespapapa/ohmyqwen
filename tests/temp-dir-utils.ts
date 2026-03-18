import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

function isRetryableRemoveError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
}

export async function rmWithRetry(dir: string, attempts = 6): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableRemoveError(error) || attempt === attempts - 1) {
        throw error;
      }
      await delay(50 * (attempt + 1));
    }
  }

  if (lastError) {
    throw lastError;
  }
}
