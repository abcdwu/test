import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('Fly Docker build context retains every explicitly copied root asset', () => {
  const dockerfile = read('Dockerfile');
  const allowed = new Set(read('.dockerignore').split(/\r?\n/).map(line => line.trim()));
  for (const line of dockerfile.split(/\r?\n/).filter(line => /^COPY\s+/.test(line))) {
    const parts = line.trim().split(/\s+/).slice(1, -1);
    for (const file of parts) {
      if (file.endsWith('/')) continue; // Directories use separate allowlisting rules.
      assert.ok(existsSync(new URL('../' + file, import.meta.url)), `Docker asset missing: ${file}`);
      assert.ok(allowed.has('!' + file), `Docker context excludes required asset: ${file}`);
    }
  }
  assert.match(dockerfile, /question-translation\.js/);
});
