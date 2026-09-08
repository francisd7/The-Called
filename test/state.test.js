import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadState, saveState } from '../src/state.js';

test('round-trips state through disk, creating parent dirs as needed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'state-test-'));
  const filePath = path.join(dir, 'nested', 'state.json');
  try {
    assert.deepEqual(await loadState(filePath), {});
    await saveState(filePath, { setterEod: '2026-09-08T00:00:00.000Z' });
    assert.deepEqual(await loadState(filePath), { setterEod: '2026-09-08T00:00:00.000Z' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
