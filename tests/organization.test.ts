import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Organizer, organizePaths, parseClassification, type OrganizationIO, type OrganizationRecord, type OrganizePaper, type PaperSnapshot, type Classification } from '../src/organization';
import { DEFAULT_SETTINGS } from '../src/core';
import type { JobProgress } from '../src/queue';

const paths = { root: 'Research', inbox: 'Research/Inbox' };
const paper: OrganizePaper = { folder: 'Research/Inbox/Example', notePath: 'Research/Inbox/Example/Example.md', title: 'Example', created: 1 };
const existing: Classification = { category: 'Learning', create: false, description: '', reason: '学習方法が主な貢献だから' };
const newCategory: Classification = { category: 'New Topic', create: true, description: '対象：新しい研究テーマ\n対象外：既存の学習方法', reason: '既存分類に当てはまらない' };
function progress(): JobProgress { return { controller: new AbortController(), update() {}, commit() {} }; }
class Memory implements OrganizationIO {
  papers = new Map<string, PaperSnapshot>([[paper.folder, { ...paper, text: '# Example\nMy memo', fingerprint: '', routing: 'pending' }]]);
  folders = new Set(['Research', 'Research/Inbox', 'Research/Learning']);
  guides = new Map<string, string>(); saved: OrganizationRecord[] = []; writes = 0; moves = 0;
  failMove = false; failSave = false;
  async readPaper(p: OrganizePaper): Promise<PaperSnapshot> {
    const current = this.papers.get(p.folder); if (!current || p.notePath !== current.notePath) throw Error('missing paper');
    return { ...current, fingerprint: JSON.stringify([current.text, current.routing, current.marker]) };
  }
  async inspect(path: string): Promise<'folder' | null> { return this.papers.has(path) || this.folders.has(path) ? 'folder' : null; }
  async createCategory(path: string, description: string) { if (await this.inspect(path)) throw Error('collision'); this.folders.add(path); this.guides.set(path, description); }
  async cleanupCategory(c: { path: string; description: string }) {
    if ([...this.papers.keys()].some(p => p.startsWith(c.path + '/')) || this.guides.get(c.path) !== c.description) return;
    this.folders.delete(c.path); this.guides.delete(c.path);
  }
  async mark(p: PaperSnapshot, r: OrganizationRecord) {
    const current = await this.readPaper(p); if (current.fingerprint !== p.fingerprint) throw Error('edited');
    const stored = this.papers.get(p.folder)!; stored.routing = 'classified'; stored.marker = r.id;
  }
  async restoreMetadata(p: PaperSnapshot, r: OrganizationRecord) {
    const stored = this.papers.get(p.folder)!; if (stored.marker !== r.id || stored.routing !== 'classified') throw Error('changed marker');
    stored.routing = r.previousRouting; stored.marker = r.previousMarker;
  }
  async move(from: string, to: string) {
    if (this.failMove) throw Error('move failed'); if (await this.inspect(to)) throw Error('collision');
    const stored = this.papers.get(from); if (!stored) throw Error('missing source');
    this.papers.delete(from); stored.folder = to; stored.notePath = to + '/' + stored.notePath.split('/').pop(); this.papers.set(to, stored); this.moves++;
  }
  async persist(records: OrganizationRecord[]) { if (this.failSave) throw Error('save failed'); this.saved = structuredClone(records); this.writes++; }
}
test('move and undo preserve memo edits, restore routing and keep a durable history', async () => {
  const io = new Memory(), organizer = new Organizer(io, []);
  assert.equal(await organizer.organize('one', paper, paths, async()=>existing, progress()), 'Research/Learning/Example/Example.md');
  const moved = io.papers.get('Research/Learning/Example')!; moved.text += '\nNew personal writing';
  assert.equal(io.saved[0].state, 'done');
  await organizer.undo('one', progress());
  assert.match(io.papers.get(paper.folder)!.text, /New personal writing/);
  assert.equal(io.papers.get(paper.folder)!.routing, 'pending'); assert.equal(io.papers.get(paper.folder)!.marker, undefined);
  assert.equal(io.saved[0].state, 'undone'); assert.equal(io.moves, 2);
});
test('new category gets criteria and is removed on undo only while unused and unchanged', async () => {
  for (const edited of [false, true]) {
    const io = new Memory(), organizer = new Organizer(io, []);
    await organizer.organize('one', paper, paths, async()=>newCategory, progress());
    assert.equal(io.guides.get('Research/New Topic'), newCategory.description);
    if (edited) io.guides.set('Research/New Topic', 'User-edited criteria');
    await organizer.undo('one', progress());
    assert.equal(io.folders.has('Research/New Topic'), edited);
  }
});
test('undo does not remove a new category now used by another paper', async () => {
  const io = new Memory(), organizer = new Organizer(io, []);
  await organizer.organize('one', paper, paths, async()=>newCategory, progress());
  io.papers.set('Research/New Topic/Other', {...paper, folder:'Research/New Topic/Other', text:'Other', fingerprint:''});
  await organizer.undo('one', progress()); assert.equal(io.folders.has('Research/New Topic'), true);
});
test('destination collisions and occupied undo destinations stop without overwriting', async () => {
  const io = new Memory(), organizer = new Organizer(io, []);
  io.folders.add('Research/Learning/Example');
  await assert.rejects(organizer.organize('one',paper,paths,async()=>existing,progress()), /同名/);
  assert.equal(io.moves,0); io.folders.delete('Research/Learning/Example');
  await organizer.organize('one',paper,paths,async()=>existing,progress()); io.folders.add(paper.folder);
  await assert.rejects(organizer.undo('one',progress()),/同名/); assert.equal(io.moves,1);
});
test('cancelled or edited papers stay in the inbox; manual placement and out-of-scope folders are protected', async () => {
  const io = new Memory(), organizer = new Organizer(io, []), p = progress();
  await assert.rejects(organizer.organize('one',paper,paths,async()=>{p.controller.abort();return existing;},p));
  await assert.rejects(organizer.organize('two',paper,paths,async()=>{io.papers.get(paper.folder)!.text+='edit';return existing;},progress()),/変更/);
  io.papers.get(paper.folder)!.routing='manual';
  await assert.rejects(organizer.organize('three',paper,paths,async()=>existing,progress()),/手動/);
  await assert.rejects(organizer.organize('four',{...paper,folder:'Other/Example'},paths,async()=>existing,progress()),/未整理/);
  assert.equal(io.moves,0); assert.equal(organizer.records.length,0);
});
test('a failed move rolls back metadata and the new category; retry keeps one history entry', async () => {
  const io = new Memory(), organizer = new Organizer(io, []);io.failMove=true;
  await assert.rejects(organizer.organize('one',paper,paths,async()=>newCategory,progress()),/move failed/);
  assert.equal(io.papers.get(paper.folder)!.routing,'pending');assert.equal(io.folders.has('Research/New Topic'),false);
  io.failMove=false;await organizer.organize('one',paper,paths,async()=>newCategory,progress());
  assert.equal(organizer.records.length,1);assert.equal(organizer.records[0].state,'done');
});
test('saving intent must succeed before changes; inability to classify leaves a result without moving', async () => {
  const io = new Memory(), organizer = new Organizer(io, []);io.failSave=true;
  await assert.rejects(organizer.organize('one',paper,paths,async()=>existing,progress()),/save failed/);
  assert.equal(io.moves,0);assert.equal(io.papers.get(paper.folder)!.marker,undefined);
  io.failSave=false;await organizer.organize('one',paper,paths,async()=>({...existing,category:null,reason:'本文が不足'}),progress());
  assert.equal(io.moves,0);assert.equal(io.saved[0].state,'unchanged');assert.equal(io.saved[0].reason,'本文が不足');
});
test('restart recovers a moved paper and an interrupted undo using identity markers', async () => {
  const io=new Memory(),organizer=new Organizer(io,[]);
  await organizer.organize('one',paper,paths,async()=>existing,progress());
  const journal=structuredClone(io.saved);journal[0].state='prepared';
  const recovered=new Organizer(io,journal);await recovered.recover();assert.equal(recovered.records[0].state,'done');
  recovered.records[0].state='restoring';await io.move(recovered.records[0].to,recovered.records[0].from);
  await recovered.recover();assert.equal(recovered.records[0].state,'undone');assert.equal(io.papers.get(paper.folder)!.routing,'pending');
});
test('undo rejects a different paper substituted at the same path',async()=>{
  const io=new Memory(),organizer=new Organizer(io,[]);await organizer.organize('one',paper,paths,async()=>existing,progress());
  io.papers.get('Research/Learning/Example')!.marker='different-operation';
  await assert.rejects(organizer.undo('one',progress()),/識別情報/);assert.equal(io.moves,1);
});
test('classification accepts known categories, rejects unsafe new paths, and handles uncertainty',()=>{
  const categories=[{path:'Learning',description:'Criteria'}];
  assert.equal(parseClassification(JSON.stringify({...existing,category:'learning',create:true}),categories).create,false);
  for(const category of ['../Other','Bad/Child','.hidden','CON']) assert.throws(()=>parseClassification(JSON.stringify({...newCategory,category}),categories));
  assert.throws(()=>parseClassification(JSON.stringify({...existing,category:'Invented'}),categories));
  assert.equal(parseClassification(JSON.stringify({...existing,category:null}),categories).category,null);
  assert.deepEqual(organizePaths({...DEFAULT_SETTINGS,folder:'Custom Papers'}),{root:'Custom Papers',inbox:'Custom Papers/未整理'});
  assert.throws(()=>organizePaths({...DEFAULT_SETTINGS,folder:'Research',organizeInbox:'Research'}));
});
