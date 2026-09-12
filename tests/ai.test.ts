import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { runProcess } from '../src/ai';
test('CLI runner sends text as stdin and never interprets shell expressions', async () => {
  const text = '$(touch SHOULD_NOT_EXIST) `echo secret` \n 日本語';
  const result = await runProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], text, tmpdir(), 5000);
  assert.equal(result, text);
});
test('CLI runner times out and supports cancellation', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], '', tmpdir(), 50), /時間切れ/);
  const controller = new AbortController();
  const p = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], '', tmpdir(), 5000, controller.signal);
  controller.abort(); await assert.rejects(p, /キャンセル/);
});
