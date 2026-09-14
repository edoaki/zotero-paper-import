import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { invokeAI } from '../src/ai';
import { DEFAULT_SETTINGS, migrateAISettings, parseAI, type Settings } from '../src/core';
import { parseAntigravityOutput } from '../src/antigravity';

test('Antigravity accepts a single successful final result and rejects failures or partial output', () => {
  const payload = { name: null, reason: 'test', evidence: '' };
  assert.deepEqual(parseAI(parseAntigravityOutput(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', structured_output: payload } }))), payload);
  assert.deepEqual(parseAI(parseAntigravityOutput(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: JSON.stringify(payload) } }))), payload);
  for (const result of [{status:'ERROR', response:JSON.stringify(payload)}, {status:'CANCELLED'}, {status:'SUCCESS'}, {status:'SUCCESS', error:'failure', structured_output:payload}]) {
    assert.throws(() => parseAntigravityOutput(JSON.stringify({event:'result', result})), /Antigravity/);
  }
  assert.throws(() => parseAntigravityOutput('{"event":"init"}'), /Antigravity/);
  assert.throws(() => parseAntigravityOutput('null'), /Antigravity/);
});
test('old Gemini settings migrate without reusing its executable or model; other choices stay intact', () => {
  const previous = { ...DEFAULT_SETTINGS, folder: 'Research', provider: 'gemini', cliPath: '/bin/gemini', model: 'flash' } as unknown as Settings;
  const next = migrateAISettings(previous);
  assert.equal(next.provider, 'antigravity'); assert.equal(next.model, ''); assert.equal(next.cliPath, ''); assert.equal(next.folder, 'Research');
  assert.equal(previous.model, 'flash'); assert.equal(migrateAISettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
});
test('Antigravity invocation sends full input over stdin and creates an isolated agent limited to finishing a response', async () => {
  if (process.platform === 'win32') return;
  const directory = await mkdtemp(join(tmpdir(), 'zpi-agy-test-'));
  const executable = join(directory, 'agy');
  await writeFile(executable, `#!${process.execPath}
const fs=require('node:fs'),assert=require('node:assert/strict');
const args=process.argv.slice(2);
if(args[0]==='models'){console.log('gemini-3-flash     Gemini 3 Flash');process.exit(0);}
assert.equal(args[args.indexOf('--model')+1],'gemini-3-flash');
assert.equal(args[args.indexOf('--input-format')+1],'stream-json');
assert.equal(args[args.indexOf('--agent')+1],'zpi-paper-namer');
assert.ok(!args.includes('--dangerously-skip-permissions'));
const agent=fs.readFileSync('.agents/agents/zpi-paper-namer/agent.md','utf8');
assert.ok(agent.includes('tools: [finish]')); assert.ok(agent.includes('commandExecutionPolicy: off'));
let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{
const msg=JSON.parse(input);assert.equal(msg.event,'user');assert.ok(msg.message.content.includes('日本語'));
console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',structured_output:{name:null,reason:msg.message.content,evidence:''}}}));});
`, {mode:0o700});
  try {
    const prompt = '日本語\n' + 'paper text '.repeat(20000) + '`echo example` $(example)';
    const output = parseAI(await invokeAI({...DEFAULT_SETTINGS, provider:'antigravity', cliPath:executable},prompt));
    assert.equal(output.reason, prompt.slice(0,4000));
  } finally { await rm(directory, {recursive:true,force:true}); }
});
