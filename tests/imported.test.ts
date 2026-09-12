import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImportedPapers, inFolder, unimportedPage } from '../src/imported';
import { type Paper, type RecordData } from '../src/core';

const paper: Paper = { serverId: 'db-one', library: 'users/0', item: { key: 'ABCDEFGH', data: { title: 'Example paper' } } };
test('legacy keys hide personal items including notes without plugin metadata', () => {
  for (const library of [undefined, 'My Library', 'マイライブラリ', 'users/0']) {
    const index = new ImportedPapers(); index.add({ 'zotero-key': paper.item.key, 'zotero-library': library });
    assert.equal(index.has(paper), true);
    assert.equal(index.has({ ...paper, library: 'groups/123' }), false);
    assert.equal(index.has({ ...paper, item: { ...paper.item, key: 'OTHERKEY' } }), false);
  }
});
test('library links distinguish group items and conflicting identities are not hidden', () => {
  const index = new ImportedPapers();
  index.add({ 'zotero-key': paper.item.key }, '[Zotero](zotero://select/groups/123/items/ABCDEFGH)');
  assert.equal(index.has(paper), false);
  assert.equal(index.has({ ...paper, library: 'groups/123' }), true);
  const conflict = new ImportedPapers();
  conflict.add({ 'zotero-key': paper.item.key, 'zotero-library': 'users/0' }, 'zotero://select/groups/123/items/ABCDEFGH');
  assert.equal(conflict.has(paper), false);
});
test('managed records require both database and library; damaged records never weaken matching', () => {
  const index = new ImportedPapers();
  const record: RecordData = { schema: 1, key: paper.item.key, library: paper.library, serverId: paper.serverId, attachments: [], naming: { name: 'example2026', mode: 'author-year', reason: 'test' }, updated: '', pdfStatus: 'not-downloaded' };
  index.add({ zpi: record, 'zotero-key': paper.item.key });
  assert.equal(index.has(paper), true);
  assert.equal(index.has({ ...paper, serverId: 'db-two' }), false);
  assert.equal(index.has({ ...paper, library: 'groups/123' }), false);
  const broken = new ImportedPapers(); broken.add({ zpi: { ...record, schema: 9 }, 'zotero-key': paper.item.key });
  assert.equal(broken.has(paper), false);
});
test('folder scope includes classifications and respects path boundaries without a fixed name', () => {
  assert.equal(inFolder('Research/Papers/Methods/Example/Example.md', 'Research/Papers/'), true);
  assert.equal(inFolder('Research/Papers-old/Example.md', 'Research/Papers'), false);
  assert.equal(inFolder('Other/Example.md', 'Research/Papers'), false);
});
test('fully imported pages do not hide older unimported papers and cancellation stops paging', async () => {
  const calls: number[] = [];
  const result = await unimportedPage(async start => {
    calls.push(start); return { items: [{ key: start ? 'NEWPAPER' : 'ABCDEFGH', data: {} }], hasMore: !start };
  }, item => item.key === 'ABCDEFGH', new AbortController().signal);
  assert.deepEqual(calls, [0, 100]); assert.equal(result.hidden, 1);
  assert.deepEqual(result.items.map(i => i.key), ['NEWPAPER']);
  const controller = new AbortController();
  await assert.rejects(unimportedPage(async () => { controller.abort(); return { items: [], hasMore: true }; }, () => false, controller.signal));
});
