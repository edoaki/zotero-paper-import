import { identity, readRecord, type Paper, type ZoteroItem } from './core';

/** Match old Zotlit notes as well as plugin records, without matching titles. */
export class ImportedPapers {
  private managed = new Set<string>();
  private legacy = new Set<string>();
  add(frontmatter: Record<string, unknown>, text = ''): void {
    const record = readRecord(frontmatter);
    if (record) {
      this.managed.add(`${record.serverId}:${record.library}:${record.key}`);
      return;
    }
    // A damaged managed record must not fall back to a less precise identity.
    if (frontmatter.zpi) return;
    const key = frontmatter['zotero-key'];
    if (typeof key !== 'string' || !/^[A-Z0-9]{8}$/.test(key)) return;
    const declared = frontmatter['zotero-library'];
    let library: string | undefined;
    if (typeof declared === 'string') {
      if (/^(users\/0|groups\/\d+)$/.test(declared)) library = declared;
      else if (['My Library', 'マイライブラリ', 'library'].includes(declared)) library = 'users/0';
    }
    const links = [...text.matchAll(/zotero:\/\/select\/(library|groups\/\d+|users\/\d+)\/items\/([A-Z0-9]{8})\b/g)]
      .filter(m => m[2] === key).map(m => m[1] === 'library' || m[1].startsWith('users/') ? 'users/0' : m[1]);
    const libraries = new Set(links);
    if (library) libraries.add(library);
    if (libraries.size > 1) return; // Conflicting metadata is not proof of an import.
    library = libraries.values().next().value;
    // Historical Zotlit notes in a personal library often contain only a key.
    if (!library && !declared) library = 'users/0';
    if (library) this.legacy.add(`${library}:${key}`);
  }
  has(paper: Paper): boolean {
    return this.managed.has(identity(paper)) || this.legacy.has(`${paper.library}:${paper.item.key}`);
  }
}

export function inFolder(path: string, folder: string): boolean {
  const root = folder.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return !!root && path.startsWith(root + '/');
}

export async function unimportedPage(
  fetchPage: (start: number) => Promise<{ items: ZoteroItem[]; hasMore: boolean }>,
  alreadyImported: (item: ZoteroItem) => boolean,
  signal: AbortSignal,
): Promise<{ items: ZoteroItem[]; hidden: number; hasMore: boolean }> {
  const result = { items: [] as ZoteroItem[], hidden: 0, hasMore: false };
  let start = 0;
  do {
    signal.throwIfAborted();
    const page = await fetchPage(start);
    signal.throwIfAborted();
    for (const item of page.items) {
      if (alreadyImported(item)) result.hidden++;
      else result.items.push(item);
    }
    result.hasMore = page.hasMore; start += 100;
  } while (result.hasMore && result.items.length < 100);
  return result;
}
