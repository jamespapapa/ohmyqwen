import fs from 'node:fs/promises';
import path from 'node:path';

async function copyEntry(src, dest, seen = new Set()) {
  const stat = await fs.lstat(src);
  if (stat.isSymbolicLink()) {
    const real = await fs.realpath(src);
    const key = `${src}->${real}`;
    if (seen.has(key)) return;
    seen.add(key);
    return copyEntry(real, dest, seen);
  }

  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      await copyEntry(path.join(src, entry.name), path.join(dest, entry.name), seen);
    }
    return;
  }

  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

async function main() {
  const [src, dest] = process.argv.slice(2);
  if (!src || !dest) {
    console.error('usage: node scripts/materialize-tree.mjs <src> <dest>');
    process.exit(1);
  }
  await copyEntry(path.resolve(src), path.resolve(dest));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
