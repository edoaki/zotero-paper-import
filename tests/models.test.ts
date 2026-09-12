import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultModels, codexOptions, openCodeOptions, listCodexModels } from '../src/models';
import { geminiArguments, parseGeminiOutput } from '../src/ai';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('model choices use CLI aliases without requiring the user to enter an ID', () => {
  assert.deepEqual(defaultModels('claude').map(m => m.value), ['', 'sonnet', 'opus', 'haiku']);
  assert.deepEqual(defaultModels('gemini').map(m => m.value), ['', 'auto', 'pro', 'flash', 'flash-lite']);
  for (const p of ['codex', 'claude', 'gemini', 'opencode'] as const) assert.equal(defaultModels(p)[0].value, '');
});
test('Codex catalog excludes hidden or non-text models, preserving actual model IDs', () => {
  assert.deepEqual(codexOptions([
    { model: 'visible', displayName: 'Visible model', isDefault: true, inputModalities: ['text'] },
    { model: 'hidden', hidden: true }, { model: 'audio-only', inputModalities: ['audio'] }, null,
  ]), [{ value: 'visible', label: 'Visible model（標準）' }]);
});
test('OpenCode model list rejects logs and deduplicates catalog entries', () => {
  assert.deepEqual(openCodeOptions('provider/model-a\nLog: loaded config\nprovider/model-a\nother/model-b\n'), [{ value: 'provider/model-a', label: 'provider/model-a' }, { value: 'other/model-b', label: 'other/model-b' }]);
});
test('Gemini adapter unwraps response JSON and rejects failed or empty responses', () => {
  const output = '{"name":null,"reason":"test","evidence":""}';
  assert.equal(parseGeminiOutput(JSON.stringify({ response: output, stats: {} })), output);
  for (const s of ['{}', '{"error":{"message":"auth"}}', 'not json']) assert.throws(() => parseGeminiOutput(s), /Gemini/);
  const args = geminiArguments('/tmp/directory with spaces', 'flash');
  assert.ok(args.includes('/tmp/directory with spaces/no-tools.toml'));
  assert.ok(args.includes('plan'));
  assert.deepEqual(args.slice(-2), ['--model', 'flash']);
});
test('Codex model discovery handshakes, follows pagination and closes its child process', async () => {
  if (process.platform === 'win32') return;
  const directory = await mkdtemp(join(tmpdir(), 'zpi-model-test-'));
  const executable = join(directory, 'codex');
  await writeFile(executable, `#!${process.execPath}\nconst rl=require('node:readline').createInterface({input:process.stdin});\nlet initialized=false;rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize'){console.log(JSON.stringify({id:m.id,result:{}}));}else if(m.method==='initialized'){initialized=true;}else if(m.method==='model/list'){if(!initialized)process.exit(3);const second=!!m.params.cursor;console.log(JSON.stringify({id:m.id,result:{data:[{model:second?'second':'first',displayName:second?'Second':'First'}],nextCursor:second?null:'page2'}}));}});\n`, { mode: 0o700 });
  try { assert.deepEqual((await listCodexModels(executable)).map(m => m.value), ['first', 'second']); }
  finally { await rm(directory, { recursive: true, force: true }); }
});
