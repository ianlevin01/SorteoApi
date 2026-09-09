import { pathToFileURL } from 'node:url';

/** true si este modulo se ejecuto directamente (node scripts/x.js). */
export function isMain(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return importMetaUrl === pathToFileURL(entry).href;
}
