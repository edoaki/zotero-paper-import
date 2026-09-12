import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Importer, type Storage, type StoredNote } from '../src/importer';
import { DEFAULT_SETTINGS, readRecord, initialNote, replaceGenerated, authorYear, safeName, validateFolder, parseAI, type Paper, type RecordData } from '../src/core';

const paper: Paper = { serverId: 'test-instance', library: 'users/0', item: { key: 'ABCDEFGH', data: { title: 'Example method paper', date: '2025-08-01', creators: [{ creatorType: 'author', lastName: 'Smith' }], url: 'https://example.org/paper' } } };
const settings = { ...DEFAULT_SETTINGS, folder: 'Research/My Papers' };
const naming = { name: 'METHOD', reason: 'Verified', mode: 'method' as const };
const pdf = { key: 'PDFABCDE', bytes: Buffer.from('%PDF-1.7\nsynthetic fixture') };
class MemoryStore implements Storage {
  files = new Map<string, Uint8Array>(); folders = new Set<string>(); backups = 0;
  async records(): Promise<StoredNote[]> {
    const result: StoredNote[] = [];
    for (const [path, bytes] of this.files) {
      if (!path.endsWith('.md')) continue;
      const text = Buffer.from(bytes).toString();
      const m = text.match(/^zpi: (.+)$/m);
      if (m) { const record = readRecord({ zpi: JSON.parse(m[1]) }); if (record) result.push({ path, text, record }); }
    }
    return result;
  }
  async exists(p: string) { return this.files.has(p) || this.folders.has(p); }
  async children(p: string) { return [...this.files.keys(), ...this.folders].filter(x => x.startsWith(p + '/') && !x.slice(p.length + 1).includes('/')).map(x => x.slice(p.length + 1)); }
  async mkdir(p: string) { this.folders.add(p); }
  async reserveFolder(p: string) { if (await this.exists(p)) throw new Error('exists'); this.folders.add(p); }
  async createText(p: string, text: string) { if (await this.exists(p)) throw new Error('exists'); this.files.set(p, Buffer.from(text)); }
  async createBinary(p: string, b: Uint8Array) { if (await this.exists(p)) throw new Error('exists'); this.files.set(p, Uint8Array.from(b)); }
  async readBinary(p: string) { const b = this.files.get(p); if (!b) throw new Error('missing'); return b; }
  async writeBinary(p: string, b: Uint8Array) { this.files.set(p, Uint8Array.from(b)); }
  async removeCreated(p: string) { this.files.delete(p); }
  async updateNote(n: StoredNote, record: RecordData, generated: string) {
    const current = Buffer.from(await this.readBinary(n.path)).toString();
    if (current !== n.text) throw new Error('concurrent edit');
    this.files.set(n.path, Buffer.from(replaceGenerated(current, generated).replace(/^zpi: .+$/m, 'zpi: ' + JSON.stringify(record))));
  }
  async backup() { this.backups++; }
}
test('one import creates sibling note and verified PDF, second import reuses it', async () => {
  const s = new MemoryStore(), i = new Importer(s);
  const result = await i.import(paper, settings, naming, [pdf]);
  assert.equal(result.path, 'Research/My Papers/METHOD/METHOD.md');
  assert.ok(Buffer.from(await s.readBinary(result.path)).toString().includes('./%E6%9C%AC%E6%96%87.pdf'));
  assert.deepEqual(await s.readBinary('Research/My Papers/METHOD/本文.pdf'), Uint8Array.from(pdf.bytes));
  assert.equal((await i.import(paper, settings, naming, [pdf])).existing, true);
  assert.equal((await s.records()).length, 1);
});
test('identity survives manual folder moves and a changed destination setting', async () => {
  const s = new MemoryStore(), i = new Importer(s);
  const first = await i.import(paper, settings, naming, [pdf]);
  const content = s.files.get(first.path)!; s.files.delete(first.path); s.files.set('My category/My name/My name.md', content);
  assert.equal((await i.import(paper, { ...settings, folder: 'Elsewhere' }, naming, [pdf])).path, 'My category/My name/My name.md');
});
test('different papers with colliding names never merge folders', async () => {
  const s = new MemoryStore(), i = new Importer(s);
  await i.import(paper, settings, naming, [pdf]);
  const other = { ...paper, item: { ...paper.item, key: 'IJKLMNOP' } };
  assert.equal((await i.import(other, settings, { ...naming, name: 'method' }, [pdf])).path, 'Research/My Papers/method-2/method-2.md');
});
test('same key from a different Zotero database stops rather than creating an accidental duplicate', async () => {
  const s = new MemoryStore(), i = new Importer(s);
  await i.import(paper, settings, naming, [pdf]);
  await assert.rejects(i.import({ ...paper, serverId: 'different' }, settings, naming, [pdf]), /別のZotero/);
});
test('refresh preserves personal notes while updating metadata and PDF', async () => {
  const s = new MemoryStore(), i = new Importer(s);
  const first = await i.import(paper, settings, naming, [pdf]);
  s.files.set(first.path, Buffer.from(Buffer.from(s.files.get(first.path)!).toString() + 'My important thoughts\n'));
  const note = (await s.records())[0];
  const newPDF = { ...pdf, bytes: Buffer.from('%PDF-1.7\nnew version') };
  await i.update(note, { ...paper, item: { ...paper.item, data: { ...paper.item.data, title: 'Updated title' } } }, settings, [newPDF]);
  const text = Buffer.from(await s.readBinary(first.path)).toString();
  assert.ok(text.includes('My important thoughts')); assert.ok(text.includes('Updated title'));
  assert.equal(s.backups, 1);
  assert.deepEqual(await s.readBinary('Research/My Papers/METHOD/本文.pdf'), Uint8Array.from(newPDF.bytes));
});
test('locally annotated PDF stops refresh before any write', async () => {
  const s = new MemoryStore(), i = new Importer(s);
  const first = await i.import(paper, settings, naming, [pdf]);
  const edited = Buffer.from('%PDF-1.7\niPad handwriting'); s.files.set('Research/My Papers/METHOD/本文.pdf', edited);
  await assert.rejects(i.update((await s.records())[0], paper, settings, [pdf]), /編集/);
  assert.equal(s.backups, 0); assert.deepEqual(s.files.get('Research/My Papers/METHOD/本文.pdf'), edited);
  assert.ok(await s.exists(first.path));
});
test('failed note creation cleans up its own unchanged PDF copies', async () => {
  const s = new MemoryStore(), i = new Importer(s); s.createText = async () => { throw new Error('disk full'); };
  await assert.rejects(i.import(paper, settings, naming, [pdf]), /disk full/);
  assert.equal(s.files.size, 0);
});
test('missing PDF is recorded; later refresh can add it without creating a new note', async () => {
  const s = new MemoryStore(), i = new Importer(s);
  const first = await i.import(paper, settings, naming, [], 'Download in Zotero');
  let note = (await s.records())[0]; assert.match(note.record.pdfStatus, /not-downloaded/); assert.ok(!note.text.includes('./%E6%9C%AC%E6%96%87.pdf'));
  await i.update(note, paper, settings, [pdf]); note = (await s.records())[0];
  assert.equal(note.record.pdfStatus, 'stored'); assert.equal(note.path, first.path);
});
test('a concurrent note edit rolls back our PDF update and keeps the edit', async () => {
  const s = new MemoryStore(), i = new Importer(s);
  const first = await i.import(paper, settings, naming, [pdf]);
  const note = (await s.records())[0];
  s.files.set(first.path, Buffer.from(note.text + 'Concurrent user edit'));
  await assert.rejects(i.update(note, paper, settings, [{ ...pdf, bytes: Buffer.from('%PDF-1.7\nupdated') }]), /concurrent edit/);
  assert.deepEqual(await s.readBinary('Research/My Papers/METHOD/本文.pdf'), Uint8Array.from(pdf.bytes));
  assert.ok(Buffer.from(await s.readBinary(first.path)).toString().includes('Concurrent user edit'));
});
test('naming handles dates, missing authors, dangerous filenames and Unicode byte limits', () => {
  assert.equal(authorYear(paper.item), 'smith2025');
  assert.equal(authorYear({ key: 'ABCDEFGH', data: {} }), 'item-ABCDEFGH');
  assert.ok(!/[\\/]/.test(safeName('../../A/B:*?')));
  assert.ok(Buffer.byteLength(safeName('手法'.repeat(200))) <= 160);
  assert.match(safeName('CON'), /^paper-/);
  for (const bad of ['', '../Papers', '/tmp', '.obsidian', 'Papers/../Private', 'C:\\docs']) assert.throws(() => validateFolder(bad));
  assert.equal(validateFolder('研究/Papers'), '研究/Papers');
});
test('AI output requires evidence and a bounded valid shape', () => {
  assert.deepEqual(parseAI('{"name":null,"reason":"not found","evidence":""}'), { name: null, reason: 'not found', evidence: '' });
  assert.throws(() => parseAI('{"name":"MADEUP","reason":"maybe","evidence":""}'));
  assert.throws(() => parseAI('not json'));
});
