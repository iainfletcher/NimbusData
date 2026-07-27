/**
 * Enforces the one rule in ARCHITECTURE.md: the simulation core stays
 * engine-agnostic, so a future move to another engine is a rendering rewrite
 * rather than a rewrite.
 *
 * Dependency direction is strictly app -> render -> sim, never upward.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

/** Layer -> the things it must not import. */
const FORBIDDEN = {
  sim: [
    { pattern: /^pixi\.js/, why: 'sim must not depend on a rendering library' },
    { pattern: /(^|\/)\.\.\/render/, why: 'sim must not import from render' },
    { pattern: /(^|\/)\.\.\/app/, why: 'sim must not import from app' },
  ],
  render: [{ pattern: /(^|\/)\.\.\/app/, why: 'render must not import from app' }],
};

const BROWSER_GLOBALS = /\b(document|window|navigator|localStorage)\b/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

let failures = 0;

for (const [layer, rules] of Object.entries(FORBIDDEN)) {
  const dir = join(SRC, layer);
  let files;
  try {
    files = walk(dir);
  } catch {
    continue;
  }

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const shown = relative(ROOT, file);

    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1];
      for (const rule of rules) {
        if (rule.pattern.test(spec)) {
          console.error(`✗ ${shown}\n    imports "${spec}" — ${rule.why}`);
          failures++;
        }
      }
    }

    if (layer === 'sim') {
      // Strip comments before looking for browser globals, so prose can mention them.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      const hit = code.match(BROWSER_GLOBALS);
      if (hit) {
        console.error(`✗ ${shown}\n    uses browser global "${hit[0]}" — sim must run headless`);
        failures++;
      }
      if (/Math\.random\s*\(/.test(code)) {
        console.error(`✗ ${shown}\n    uses Math.random — sim must be deterministic (see rng.ts)`);
        failures++;
      }
    }
  }
}

if (failures > 0) {
  console.error(`\nLayer check failed: ${failures} violation(s).`);
  process.exit(1);
}

console.log('Layer check passed — sim is clean.');
