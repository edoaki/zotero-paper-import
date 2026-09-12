import { safeName, validateFolder, type Settings } from './core';
import type { JobProgress } from './queue';

export interface OrganizePaths { inbox: string; root: string }
export interface OrganizePaper { folder: string; notePath: string; title: string; created: number }
export interface PaperSnapshot extends OrganizePaper {
  text: string; fingerprint: string; routing?: unknown; marker?: unknown;
}
export interface Category { path: string; description: string }
export interface Classification { category: string | null; create: boolean; description: string; reason: string }
export interface OrganizationRecord {
  id: string; title: string; from: string; to: string; noteName: string; created: number;
  reason: string; date: string; state: 'prepared' | 'done' | 'restoring' | 'undone' | 'failed' | 'unchanged';
  previousRouting?: unknown; previousMarker?: unknown; error?: string;
  newCategory?: { path: string; description: string };
}
export interface OrganizationIO {
  readPaper(paper: OrganizePaper): Promise<PaperSnapshot>;
  inspect(path: string): Promise<'folder' | 'file' | null>;
  createCategory(path: string, description: string): Promise<void>;
  cleanupCategory(category: { path: string; description: string }): Promise<void>;
  mark(paper: PaperSnapshot, record: OrganizationRecord): Promise<void>;
  restoreMetadata(paper: PaperSnapshot, record: OrganizationRecord): Promise<void>;
  move(from: string, to: string): Promise<void>;
  persist(records: OrganizationRecord[]): Promise<void>;
}
export const ORGANIZE_RULE = '論文の主な貢献・研究テーマを根拠に、最も適切な分類先を1つ選んでください。既存の分類説明（対象・対象外・優先基準）を尊重し、合う既存分類を優先してください。既存分類で扱えない研究テーマに限り、他の論文にも使える日本語の新分類名と、対象・対象外・他分類との優先基準を含む説明を提案してください。論文ごとの手法名だけを新分類にしないでください。内容を判断できなければcategory=nullとし、不足情報を日本語で説明してください。';
export const CLASSIFICATION_SCHEMA = { type: 'object', properties: {
  category: { type: ['string', 'null'] }, create: { type: 'boolean' }, description: { type: 'string' }, reason: { type: 'string' },
}, required: ['category', 'create', 'description', 'reason'], additionalProperties: false };
export function organizePaths(settings: Settings): OrganizePaths {
  const root = validateFolder(settings.organizeRoot || settings.folder);
  const inbox = validateFolder(settings.organizeInbox || `${root}/未整理`);
  if (root === inbox || root.startsWith(inbox + '/')) throw new Error('分類先の親フォルダには、未整理フォルダ自体やその内側を指定できません。');
  return { root, inbox };
}
export function parseClassification(raw: string, categories: Category[]): Classification {
  let data: Classification;
  try { data = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')); }
  catch { throw new Error('AIの返答を分類結果として読み取れませんでした。未整理のまま保持しました。'); }
  if (!data || !(typeof data.category === 'string' || data.category === null) || typeof data.create !== 'boolean' || typeof data.description !== 'string' || typeof data.reason !== 'string' || !data.reason.trim() || data.reason.length > 5000 || data.description.length > 10000) throw new Error('AIの分類結果の形式が不正です。未整理のまま保持しました。');
  if (data.category === null) return { ...data, create: false, description: '' };
  const category = data.category.trim().normalize('NFC');
  const existing = categories.find(c => c.path.normalize('NFC').toLocaleLowerCase() === category.toLocaleLowerCase());
  if (existing) return { ...data, category: existing.path, create: false, description: '' };
  if (!data.create || category !== safeName(category) || category.includes('/') || category.startsWith('.') || !data.description.trim()) throw new Error('AIが指定した分類先を確認できません。未整理のまま保持しました。');
  return { ...data, category };
}

/** Persistent journal: record intent before a move, recover interrupted moves, never overwrite a folder. */
export class Organizer {
  constructor(private io: OrganizationIO, readonly records: OrganizationRecord[]) {}
  private async save(): Promise<void> { await this.io.persist(structuredClone(this.records)); }
  private at(record: OrganizationRecord, folder: string): OrganizePaper {
    return { folder, notePath: `${folder}/${record.noteName}`, title: record.title, created: 0 };
  }
  async organize(id: string, paper: OrganizePaper, paths: OrganizePaths, decide: (snapshot: PaperSnapshot) => Promise<Classification>, progress: JobProgress): Promise<string> {
    const previous = this.records.find(r => r.id === id);
    if (previous?.state === 'done') {
      const current = await this.io.readPaper(this.at(previous, previous.to));
      if (current.marker === id) return current.notePath;
      throw new Error('前回の移動結果が変更されています。整理結果を確認してください。');
    }
    if (previous && ['prepared', 'restoring'].includes(previous.state)) throw new Error('前回の移動が中断しています。整理結果を確認してからプラグインを読み込み直してください。');
    if (!paper.folder.startsWith(paths.inbox + '/') || paper.folder.slice(paths.inbox.length + 1).includes('/')) throw new Error('この論文は指定した未整理フォルダの直下にありません。');
    const snapshot = await this.io.readPaper(paper);
    if (snapshot.routing === 'manual') throw new Error('手動分類として固定されているため移動しません。');
    const decision = await decide(snapshot);
    progress.controller.signal.throwIfAborted();
    if ((await this.io.readPaper(paper)).fingerprint !== snapshot.fingerprint) throw new Error('分類中に論文が編集・変更されたため、移動せず停止しました。再度選択してください。');
    const record: OrganizationRecord = { id, title: paper.title, from: paper.folder, to: paper.folder, noteName: paper.notePath.slice(paper.folder.length + 1), created: paper.created,
      reason: decision.reason, date: new Date().toISOString(), state: decision.category === null ? 'unchanged' : 'prepared', previousRouting: snapshot.routing, previousMarker: snapshot.marker };
    if (decision.category !== null) {
      const categoryPath = `${paths.root}/${decision.category}`;
      if (categoryPath === paths.inbox || categoryPath.startsWith(paths.inbox + '/') || paths.inbox.startsWith(categoryPath + '/')) throw new Error('未整理フォルダを分類先にはできません。');
      record.to = `${categoryPath}/${paper.folder.split('/').pop()}`;
      if (await this.io.inspect(record.to)) throw new Error('移動先に同名の論文フォルダがあります。統合・上書きせず停止しました。');
      const category = await this.io.inspect(categoryPath);
      if (decision.create && category) throw new Error('新分類と同名のファイル・フォルダが先に作成されました。再試行してください。');
      if (!decision.create && category !== 'folder') throw new Error('分類先が移動または削除されました。再試行してください。');
      if (decision.create) record.newCategory = { path: categoryPath, description: decision.description };
    }
    if (previous) this.records.splice(this.records.indexOf(previous), 1, record); else this.records.push(record);
    try { await this.save(); } catch (e) { record.state = 'failed'; record.error = '移動前の履歴を保存できませんでした。'; throw e; }
    if (decision.category === null) return paper.notePath;
    progress.commit(); progress.update('論文フォルダを移動中…');
    let moved = false;
    try {
      if (record.newCategory) await this.io.createCategory(record.newCategory.path, record.newCategory.description);
      await this.io.mark(snapshot, record);
      await this.io.move(record.from, record.to); moved = true;
      record.state = 'done'; await this.save();
      return `${record.to}/${record.noteName}`;
    } catch (e) {
      if (moved) { record.state = 'done'; record.error = '移動は完了しましたが、履歴保存を完了できませんでした。'; }
      else {
        try {
          const current = await this.io.readPaper(paper);
          if (current.marker === record.id) await this.io.restoreMetadata(current, record);
          if (record.newCategory) await this.io.cleanupCategory(record.newCategory);
          record.state = 'failed';
        } catch { record.state = 'prepared'; }
        record.error = (e as Error).message;
      }
      try { await this.save(); } catch { /* previously saved intent remains recoverable */ }
      throw e;
    }
  }
  async undo(id: string, progress: JobProgress): Promise<string> {
    const record = this.records.find(r => r.id === id);
    if (!record || record.state !== 'done') throw new Error('元に戻せる整理結果がありません。');
    const paper = await this.io.readPaper(this.at(record, record.to));
    if (paper.marker !== id || paper.routing !== 'classified') throw new Error('整理後に論文の識別情報や分類状態が変わりました。現在の内容を保持して停止しました。');
    if (await this.io.inspect(record.from)) throw new Error('元の場所に同名のファイル・フォルダがあります。上書きせず停止しました。');
    progress.controller.signal.throwIfAborted();
    record.state = 'restoring';
    try { await this.save(); } catch (e) { record.state = 'done'; throw e; }
    progress.commit(); progress.update('元の場所へ戻しています…');
    let moved = false;
    try {
      await this.io.move(record.to, record.from); moved = true;
      await this.io.restoreMetadata(await this.io.readPaper(this.at(record, record.from)), record);
      record.state = 'undone'; delete record.error;
      if (record.newCategory) await this.io.cleanupCategory(record.newCategory);
      await this.save();
      return `${record.from}/${record.noteName}`;
    } catch (e) {
      if (!moved) record.state = 'done';
      record.error = (e as Error).message;
      try { await this.save(); } catch { /* recovery uses the saved restoring state */ }
      throw e;
    }
  }
  async recover(): Promise<void> {
    let changed = false;
    for (const record of this.records.filter(r => r.state === 'prepared' || r.state === 'restoring')) {
      try {
        const source = await this.io.inspect(record.from), destination = await this.io.inspect(record.to);
        if (destination === 'folder' && !source) {
          const paper = await this.io.readPaper(this.at(record, record.to));
          if (paper.marker !== record.id) continue;
          record.state = 'done'; changed = true;
        } else if (source === 'folder' && !destination) {
          const paper = await this.io.readPaper(this.at(record, record.from));
          if (paper.marker === record.id) await this.io.restoreMetadata(paper, record);
          else if (JSON.stringify(paper.marker) !== JSON.stringify(record.previousMarker)) continue;
          record.state = record.state === 'restoring' ? 'undone' : 'failed';
          if (record.newCategory) await this.io.cleanupCategory(record.newCategory);
          changed = true;
        }
      } catch { /* conflicting changes require manual resolution; don't guess */ }
    }
    if (changed) await this.save();
  }
}
