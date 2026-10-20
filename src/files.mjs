import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicWrite(filename, contents) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.part`;
  try {
    await writeFile(temporary, contents, { mode: 0o600, flag: 'wx' });
    await rename(temporary, filename);
  } finally { await unlink(temporary).catch(() => {}); }
}
