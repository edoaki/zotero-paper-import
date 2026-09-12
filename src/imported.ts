import { identity, readRecord, type Paper, type ZoteroItem } from './core';

/** Match old Zotlit notes as well as plugin records, without matching titles. */
export class ImportedPapers {
  private managed = new Set<string>();
  private legacy = new Set<string>();
  private identifiers = new Set<string>();
  add(frontmatter: Record<string, unknown>, text = ''): void {
    const record = readRecord(frontmatter);
    if (record) {
      this.managed.add(`${record.serverId}:${record.library}:${record.key}`);
      return;
    }
    // A damaged managed record must not fall back to a less precise identity.
    if (frontmatter.zpi) return;
    const key = frontmatter['zotero-key'];
    const declared = frontmatter['zotero-library'];
    let library: string | undefined;
    if (typeof declared === 'string') {
      if (/^(users\/0|groups\/\d+)$/.test(declared)) library = declared;
      else if (['My Library', 'マイライブラリ', 'library'].includes(declared)) library = 'users/0';
    }
    if (key === undefined || key === null || key === '') {
      // Citation stubs can already contain a local PDF but not yet have a Zotero key.
      // Only use explicit identifier properties, never links to other papers in the body.
      const scope = library || (!declared ? 'users/0' : undefined);
      if (scope) for (const id of paperIdentifiers(frontmatter)) this.identifiers.add(`${scope}:${id}`);
      return;
    }
    if (typeof key !== 'string' || !/^[A-Z0-9]{8}$/.test(key)) return;
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
    return this.managed.has(identity(paper)) || this.legacy.has(`${paper.library}:${paper.item.key}`)
      || paperIdentifiers(paper.item.data).some(id => this.identifiers.has(`${paper.library}:${id}`));
  }
}

export function paperIdentifiers(metadata: Record<string, unknown>): string[] {
  const result = new Set<string>();
  const arxiv = (value: string) => {
    const id = value.trim().replace(/^arxiv:\s*/i, '').replace(/\.pdf$/i, '').replace(/v\d+$/i, '');
    if (/^(?:\d{4}\.\d{4,5}|[a-z][a-z.-]*\/\d{7})$/i.test(id)) result.add('arxiv:' + id.toLowerCase());
  };
  const doi = (value: string) => {
    const id = value.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '').toLowerCase();
    if (/^10\.\d{4,9}\/\S+$/.test(id)) {
      result.add('doi:' + id);
      if (id.startsWith('10.48550/arxiv.')) arxiv(id.slice('10.48550/arxiv.'.length));
    }
  };
  for (const key of ['DOI', 'doi']) if (typeof metadata[key] === 'string') doi(metadata[key]);
  for (const key of ['arxiv', 'arxiv-id', 'arxivId']) if (typeof metadata[key] === 'string') arxiv(metadata[key]);
  for (const key of ['url', 'URL', 'arxiv']) {
    if (typeof metadata[key] !== 'string') continue;
    try {
      const url = new URL(metadata[key]);
      if (['arxiv.org','www.arxiv.org','export.arxiv.org'].includes(url.hostname)) arxiv(url.pathname.replace(/^\/(?:abs|pdf|html)\//, ''));
      if (['doi.org','dx.doi.org'].includes(url.hostname)) doi(decodeURIComponent(url.pathname.slice(1)));
    } catch { /* not a URL */ }
  }
  return [...result];
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
