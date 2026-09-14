import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateAbstract } from '../src/abstract';
import { DEFAULT_SETTINGS } from '../src/core';
test('translation uses the selected AI and preserves the original abstract', async () => {
  const original = 'We improve accuracy by 12% on three datasets.';
  const result = await translateAbstract(original, { ...DEFAULT_SETTINGS, provider: 'antigravity' }, undefined, undefined, async (settings, prompt) => {
    assert.equal(settings.provider, 'antigravity');
    assert.ok(prompt.includes(original));
    assert.match(prompt, /Do not summarize/);
    return JSON.stringify({ translation: '3つのデータセットで精度を12%改善する。' });
  });
  assert.deepEqual(result, { source: original, text: '3つのデータセットで精度を12%改善する。' });
});
test('missing, disabled and unchanged abstracts require no new AI call; changed sources are translated again', async () => {
  let calls = 0; const invoke = async () => { calls++; return '{"translation":"新しい要旨の日本語訳。"}'; };
  const previous = { source: 'Original abstract.', text: '以前の日本語訳。' };
  assert.equal(await translateAbstract('', DEFAULT_SETTINGS, undefined, undefined, invoke), undefined);
  assert.equal(await translateAbstract(previous.source, { ...DEFAULT_SETTINGS, translateAbstract: false }, previous, undefined, invoke), undefined);
  assert.equal(await translateAbstract(previous.source, DEFAULT_SETTINGS, previous, undefined, invoke), previous);
  assert.equal(calls, 0);
  assert.equal((await translateAbstract('Changed abstract.', DEFAULT_SETTINGS, previous, undefined, invoke))?.text, '新しい要旨の日本語訳。');
  assert.equal(calls, 1);
});
test('translation failures and cancellation are explicit, not silently saved as untranslated success', async () => {
  for (const response of ['invalid JSON', '{"translation":""}', '{"translation":"Untranslated English."}']) {
    await assert.rejects(translateAbstract('Abstract.', DEFAULT_SETTINGS, undefined, undefined, async () => response), /日本語訳できません/);
  }
  await assert.rejects(translateAbstract('Abstract.', DEFAULT_SETTINGS, undefined, undefined, async () => { throw new Error('offline'); }), /offline/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(translateAbstract('Abstract.', DEFAULT_SETTINGS, undefined, controller.signal, async () => { throw new Error('should not run'); }), /キャンセル/);
});
