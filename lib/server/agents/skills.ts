import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Skills live as plain markdown under `skills/<name>/SKILL.md` at the
 * repo root. The whole file is the system prompt -- no front-matter
 * parsing, no template engine, nothing clever. Editing the markdown
 * is the supported way to tune any agent's behavior without a code
 * change. (Note: `next dev` and `next build` both run from the repo
 * root, so `process.cwd()` is reliable here.)
 *
 * Cached after first read because skills don't change between
 * requests in a given process; restart the server to pick up edits in
 * dev. In production a deploy reloads everything anyway.
 */

const cache = new Map<string, string>();

export async function loadSkill(name: string): Promise<string> {
  const cached = cache.get(name);
  if (cached) return cached;

  const filePath = path.join(process.cwd(), "skills", name, "SKILL.md");
  const raw = await readFile(filePath, "utf8");
  cache.set(name, raw);
  return raw;
}
