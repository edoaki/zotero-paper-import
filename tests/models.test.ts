import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultModels, codexOptions, openCodeOptions, listCodexModels, antigravityOptions, modelChoices, standardModel, resolveModel } from '../src/models';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('model choices use CLI aliases without requiring the user to enter an ID', () => {
  assert.deepEqual(defaultModels('claude').map(m => m.value), ['', 'sonnet', 'opus', 'haiku']);
  for (const p of ['codex', 'claude', 'antigravity', 'opencode'] as const) assert.equal(defaultModels(p)[0].value, '');
});
test('Codex catalog excludes hidden or non-text models, preserving actual model IDs', () => {
  assert.deepEqual(codexOptions([
    { model: 'visible', displayName: 'Visible model', isDefault: true, inputModalities: ['text'] },
    { model: 'hidden', hidden: true }, { model: 'audio-only', inputModalities: ['audio'] }, null,
  ]), [{ value: 'visible', label: 'Visible model' }]);
});
test('OpenCode model list rejects logs and deduplicates catalog entries', () => {
  assert.deepEqual(openCodeOptions('provider/model-a\nLog: loaded config\nprovider/model-a\nother/model-b\n'), [{ value: 'provider/model-a', label: 'provider/model-a' }, { value: 'other/model-b', label: 'other/model-b' }]);
});
test('Codex model discovery handshakes, follows pagination and closes its child process', async () => {
  if (process.platform === 'win32') return;
  const directory = await mkdtemp(join(tmpdir(), 'zpi-model-test-'));
  const executable = join(directory, 'codex');
  await writeFile(executable, `#!${process.execPath}\nconst rl=require('node:readline').createInterface({input:process.stdin});\nlet initialized=false;rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize'){console.log(JSON.stringify({id:m.id,result:{}}));}else if(m.method==='initialized'){initialized=true;}else if(m.method==='model/list'){if(!initialized)process.exit(3);const second=!!m.params.cursor;console.log(JSON.stringify({id:m.id,result:{data:[{model:second?'second':'first',displayName:second?'Second':'First'}],nextCursor:second?null:'page2'}}));}});\n`, { mode: 0o700 });
  try { assert.deepEqual((await listCodexModels(executable)).map(m => m.value), ['first', 'second']); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

test('Antigravity models use returned slugs and labels, not guessed model names', () => {
  assert.deepEqual(antigravityOptions('Fetching available models...\nmodel-a     First Model\nmodel-b     Second Model (High)\nmodel-a     First Model\n'), [{value:'model-a', label:'First Model'}, {value:'model-b', label:'Second Model (High)'}]);
  assert.throws(() => antigravityOptions('Error: Please sign in to view available models.'), /ログイン/);
});

test('standard chooses the newest available Terra, ignoring an Astra CLI default', () => {
  const models = codexOptions([
    { model: 'gpt-6-astra', displayName: 'GPT-6 Astra', isDefault: true },
    { model: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra' },
    { model: 'gpt-5.10-terra', displayName: 'GPT-5.10 Terra' },
    { model: 'gpt-7-terra', hidden: true },
  ]);
  assert.deepEqual(modelChoices(models, 'codex')[0], { value: '', label: 'GPT-5.10 Terra（標準）' });
  assert.equal(standardModel(models, 'codex')?.value, 'gpt-5.10-terra');
});
test('renamed balanced tier can be discovered, but unknown or premium defaults are not used', () => {
  assert.equal(standardModel(codexOptions([{ model: 'future-balanced', description: 'Balanced model for everyday tasks' }]), 'codex')?.value, 'future-balanced');
  assert.equal(standardModel(codexOptions([{ model: 'gpt-6-astra', description: 'Balanced', isDefault: true }]), 'codex'), undefined);
  assert.equal(standardModel(codexOptions([{ model: 'unknown', isDefault: true }]), 'codex'), undefined);
});
test('execution resolves an empty setting to a catalog model and preserves explicit choices', async () => {
  const { DEFAULT_SETTINGS } = await import('../src/core');
  assert.equal(await resolveModel({ ...DEFAULT_SETTINGS, provider: 'claude' }), 'sonnet');
  assert.equal(await resolveModel({ ...DEFAULT_SETTINGS, model: 'my-explicit-model' }), 'my-explicit-model');
  if (process.platform === 'win32') return;
  const directory = await mkdtemp(join(tmpdir(), 'zpi-standard-test-'));
  const executable = join(directory, 'codex');
  const script = (models: unknown[]) => `#!${process.execPath}\nconst rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')console.log(JSON.stringify({id:m.id,result:{}}));if(m.method==='model/list')console.log(JSON.stringify({id:m.id,result:{data:${JSON.stringify(models)}}}));});`;
  try {
    await writeFile(executable, script([{ model: 'gpt-6-astra', isDefault: true }, { model: 'gpt-6-terra' }]), { mode: 0o700 });
    assert.equal(await resolveModel({ ...DEFAULT_SETTINGS, cliPath: executable }), 'gpt-6-terra');
    await writeFile(executable, script([{ model: 'gpt-6-astra', isDefault: true }]), { mode: 0o700 });
    await assert.rejects(resolveModel({ ...DEFAULT_SETTINGS, cliPath: executable }), /設定でモデル/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
