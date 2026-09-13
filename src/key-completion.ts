import type { ZoteroItem } from './core';
import { paperIdentifiers } from './imported';

export function uniqueKeyMatch(metadata: Record<string, unknown>, items: ZoteroItem[]): ZoteroItem {
  if (metadata['zotero-key'] || metadata.zpi) throw new Error('既にZoteroキーまたは取り込み情報があります。上書きしません。');
  const ids = paperIdentifiers(metadata);
  if (!ids.length) throw new Error('DOI・arXiv IDがありません。ノートのプロパティに確認済みの識別子を記入してください。');
  const matches = [...new Map(items.filter(item => paperIdentifiers(item.data).some(id => ids.includes(id))).map(item => [item.key, item])).values()];
  if (!matches.length) throw new Error('一致する論文が選択したZoteroライブラリにありません。ライブラリを確認するか、Zoteroに登録してから再試行してください。');
  if (matches.length !== 1) throw new Error(`Zoteroに一致する候補が${matches.length}件あります。重複や識別子を確認し、候補を1件にしてから再試行してください。`);
  return matches[0];
}
