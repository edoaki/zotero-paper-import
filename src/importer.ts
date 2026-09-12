import { authorYear, safeName, validateFolder, initialNote, renderGenerated, recordMatches, type Paper, type Settings, type NameResult, type RecordData } from './core';
import { sha256, isPDF } from './zotero';

export interface StoredNote { path: string; text: string; record: RecordData }
export interface Storage {
  records(): Promise<StoredNote[]>;
  exists(path: string): Promise<boolean>;
  children(folder: string): Promise<string[]>;
  mkdir(path: string): Promise<void>;
  reserveFolder(path: string): Promise<void>;
  createText(path: string, text: string): Promise<void>;
  createBinary(path: string, bytes: Uint8Array): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, bytes: Uint8Array): Promise<void>;
  removeCreated(path: string): Promise<void>;
  updateNote(note: StoredNote, record: RecordData, generated: string): Promise<void>;
  backup(note: StoredNote, pdfs: { filename: string; bytes: Uint8Array }[]): Promise<void>;
}
export interface PDFInput { key: string; bytes: Uint8Array }
export class Importer {
  constructor(private storage: Storage) {}
  async find(paper: Paper): Promise<StoredNote | undefined> {
    const notes = await this.storage.records();
    const matches = notes.filter(n => recordMatches(n.record, paper));
    if (matches.length > 1) throw new Error('Duplicate Zotero identity. Keep both notes and resolve the duplicate first / 同一文献のノートが複数あります。');
    if (!matches.length && notes.some(n => n.record.key === paper.item.key && n.record.library === paper.library && n.record.serverId !== paper.serverId)) throw new Error('This paper key belongs to another Zotero database in this vault. Verify the source before importing / 別のZotero接続元に同じキーがあります。');
    return matches[0];
  }
  async import(paper: Paper, settings: Settings, name: NameResult, pdfs: PDFInput[], missingReason = ''): Promise<{ path: string; existing: boolean }> {
    const existing = await this.find(paper);
    if (existing) return { path: existing.path, existing: true };
    const base = validateFolder(settings.folder);
    for (const pdf of pdfs) if (!isPDF(pdf.bytes)) throw new Error('Invalid PDF bytes');
    await this.storage.mkdir(base);
    const names = new Set((await this.storage.children(base)).map(n => n.toLocaleLowerCase()));
    const root = safeName(name.name || authorYear(paper.item));
    let folderName = root, suffix = 2;
    while (names.has(folderName.toLocaleLowerCase())) folderName = `${root}-${suffix++}`;
    const folder = `${base}/${folderName}`;
    // createFolder is exclusive: a concurrent import must fail rather than merge papers.
    if (await this.storage.exists(folder)) throw new Error('Destination appeared during import. Retry.');
    await this.storage.reserveFolder(folder);
    const record: RecordData = {
      schema: 1, library: paper.library, key: paper.item.key, serverId: paper.serverId,
      attachments: pdfs.map((p, i) => ({ key: p.key, filename: i === 0 ? '本文.pdf' : `添付-${p.key}.pdf`, sha256: sha256(p.bytes) })),
      naming: { ...name, name: folderName }, updated: new Date().toISOString(),
      pdfStatus: pdfs.length ? 'stored' : `not-downloaded: ${missingReason || 'No stored PDF'}`,
    };
    const created: { path: string; hash: string }[] = [];
    const notePath = `${folder}/${folderName}.md`;
    try {
      for (let i = 0; i < pdfs.length; i++) {
        const path = `${folder}/${record.attachments[i].filename}`;
        await this.storage.createBinary(path, pdfs[i].bytes);
        created.push({ path, hash: record.attachments[i].sha256 });
        if (sha256(await this.storage.readBinary(path)) !== record.attachments[i].sha256) throw new Error('PDF verification failed');
      }
      await this.storage.createText(notePath, initialNote(paper, record, settings.template));
      return { path: notePath, existing: false };
    } catch (e) {
      // Only retire files created by this operation, and only if nobody changed them.
      for (const f of created) { try { if (sha256(await this.storage.readBinary(f.path)) === f.hash) await this.storage.removeCreated(f.path); } catch { /* preserve on uncertain state */ } }
      throw e;
    }
  }
  async update(note: StoredNote, paper: Paper, settings: Settings, pdfs: PDFInput[], name?: NameResult): Promise<void> {
    if (!recordMatches(note.record, paper)) throw new Error('Wrong paper for note');
    const folder = note.path.slice(0, note.path.lastIndexOf('/'));
    const prior: { filename: string; bytes: Uint8Array }[] = [];
    // Preserve tracked attachments even if they are no longer attached in Zotero.
    const attachments = note.record.attachments.map(a => ({ ...a }));
    for (const a of attachments) {
      const path = `${folder}/${a.filename}`;
      if (await this.storage.exists(path)) {
        const bytes = await this.storage.readBinary(path);
        if (sha256(bytes) !== a.sha256) throw new Error(`Vault PDF was edited; not overwritten: ${a.filename} / 保管庫側で編集されたPDFを検出したため、更新を中止しました。`);
        prior.push({ filename: a.filename, bytes });
      }
    }
    for (const p of pdfs) {
      if (!isPDF(p.bytes)) throw new Error('Invalid PDF');
      const known = attachments.find(a => a.key === p.key);
      if (known) known.sha256 = sha256(p.bytes);
      else {
        const filename = attachments.length ? `添付-${p.key}.pdf` : '本文.pdf';
        if (await this.storage.exists(`${folder}/${filename}`)) throw new Error('Untracked PDF already exists. Keep it and choose a different location.');
        attachments.push({ key: p.key, filename, sha256: sha256(p.bytes) });
      }
    }
    const record: RecordData = { ...note.record, attachments, naming: name || note.record.naming, updated: new Date().toISOString(), pdfStatus: attachments.length ? 'stored' : note.record.pdfStatus };
    const generated = renderGenerated(paper, record, settings.template);
    await this.storage.backup(note, prior);
    const changed: { path: string; hash: string; previous?: Uint8Array }[] = [];
    try { for (const p of pdfs) {
      const a = attachments.find(a => a.key === p.key)!;
      const path = `${folder}/${a.filename}`;
      const old = note.record.attachments.find(x => x.key === p.key);
      if (await this.storage.exists(path)) {
        if (!old || sha256(await this.storage.readBinary(path)) !== old.sha256) throw new Error('PDF changed while updating; backup kept / 更新中にPDFが変更されました。バックアップを保持しています。');
        if (old.sha256 !== a.sha256) {
          changed.push({ path, hash: a.sha256, previous: prior.find(x => x.filename === a.filename)?.bytes });
          await this.storage.writeBinary(path, p.bytes);
        }
      } else {
        await this.storage.createBinary(path, p.bytes);
        changed.push({ path, hash: a.sha256 });
      }
      if (sha256(await this.storage.readBinary(path)) !== a.sha256) throw new Error('PDF verification failed. Backup kept.');
    }
    await this.storage.updateNote(note, record, generated);
    } catch (e) {
      // If the note commit loses a race, restore only copies still equal to our writes.
      // Never roll back another device's intervening PDF edit. Backups remain available.
      for (const c of changed.reverse()) {
        try {
          if (sha256(await this.storage.readBinary(c.path)) !== c.hash) continue;
          if (c.previous) await this.storage.writeBinary(c.path, c.previous);
          else await this.storage.removeCreated(c.path);
        } catch { /* preserve uncertain state and the backup */ }
      }
      throw e;
    }
  }
}
