import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, type ZoteroItem } from '../src/core';
import { migrateLayout, paperPaths, literatureFolders } from '../src/layout';
import { uniqueKeyMatch } from '../src/key-completion';

test('one root determines both import inbox and organization source',()=>{
  const s=migrateLayout({...DEFAULT_SETTINGS,folder:'Research'});
  assert.deepEqual(paperPaths(s),{root:'Research',inbox:'Research/未整理'});
  assert.deepEqual(paperPaths({...s,folder:'Other',inboxName:'Pending'}),{root:'Other',inbox:'Other/Pending'});
  assert.equal(migrateLayout(s),s);
  assert.deepEqual(paperPaths(migrateLayout({...DEFAULT_SETTINGS,folder:'Research/未整理'})),{root:'Research',inbox:'Research/未整理'});
});
test('migration preserves a custom inbox and retains old folders for lookup without moving data',()=>{
  const s=migrateLayout({...DEFAULT_SETTINGS,folder:'Papers/Pending',organizeRoot:'Papers',organizeInbox:'Papers/Pending'});
  assert.deepEqual(paperPaths(s),{root:'Papers',inbox:'Papers/Pending'});
  const other=migrateLayout({...DEFAULT_SETTINGS,folder:'Papers',organizeInbox:'Outside/Pending'});
  assert.ok(literatureFolders(other).includes('Outside/Pending'));
  assert.deepEqual(paperPaths(other),{root:'Papers',inbox:'Papers/未整理'});
  assert.throws(()=>paperPaths({...s,inboxName:'../Elsewhere'}));
});
test('key completion matches a unique identifier regardless of title and normalizes arXiv versions',()=>{
  const item:ZoteroItem={key:'ABCDEFGH',data:{title:'Different title typography',url:'https://arxiv.org/html/2403.07028v2'}};
  assert.equal(uniqueKeyMatch({arxiv:'2403.07028'},[item]).key,item.key);
  assert.equal(uniqueKeyMatch({DOI:'10.48550/arXiv.2403.07028'},[item]).key,item.key);
});
test('key completion refuses ambiguous, missing or already keyed notes',()=>{
  const a:ZoteroItem={key:'ABCDEFGH',data:{url:'https://arxiv.org/abs/2403.07028'}};
  const b:ZoteroItem={key:'OTHERKEY',data:a.data};
  assert.throws(()=>uniqueKeyMatch({arxiv:'2403.07028'},[a,b]),/2件/);
  assert.throws(()=>uniqueKeyMatch({arxiv:'2403.15180'},[a]),/ありません/);
  assert.throws(()=>uniqueKeyMatch({title:'Same title'},[a]),/IDがありません/);
  assert.throws(()=>uniqueKeyMatch({'zotero-key':'EXISTING',arxiv:'2403.07028'},[a]),/上書き/);
});

test('manual destination supports nested folders and rejects paths outside the vault', () => {
  const settings = { ...DEFAULT_SETTINGS, layoutVersion: 1, folder: '研究/テーマ/文献' };
  assert.deepEqual(paperPaths(settings), { root: '研究/テーマ/文献', inbox: '研究/テーマ/文献/未整理' });
  for (const folder of ['../文献', '/tmp/文献', '研究/../../文献', '研究/.obsidian']) assert.throws(() => paperPaths({ ...settings, folder }));
});
