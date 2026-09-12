export type NamingMode = 'author-year' | 'method' | 'custom';
export type Provider = 'codex' | 'claude' | 'opencode';
export interface Rule { id: string; name: string; prompt: string }
export interface Settings {
  folder: string; naming: NamingMode; provider: Provider; cliPath: string;
  model: string; timeoutSeconds: number; fallback: 'author-year' | 'ask';
  rules: Rule[]; activeRule: string; template: string; port: number;
}
export const DEFAULT_TEMPLATE = `# {{title}}

{{authors}} · {{year}}

{{source_links}}

## PDF
{{pdf_links}}

## Abstract
{{abstract}}

## Naming
{{naming_reason}}
`;
export const DEFAULT_SETTINGS: Settings = {
  folder: '', naming: 'author-year', provider: 'codex', cliPath: '', model: '',
  timeoutSeconds: 180, fallback: 'author-year', rules: [], activeRule: '',
  template: DEFAULT_TEMPLATE, port: 23119,
};
export const METHOD_RULE = `Use the proper name or acronym of the method, model, or training procedure newly proposed by THIS paper. Do not use a baseline, an existing model merely used by the paper, a dataset, a problem name, or "Ours". Inspect the supplied paper text, including experiments and tables. Only use a name supported by explicit evidence of authorship/contribution. If the evidence is insufficient, return name=null. Never invent an acronym.`;
export interface ZoteroItem {
  key: string; version?: number; library?: { type: string; id: number; name?: string };
  data: { key?: string; itemType?: string; title?: string; date?: string;
    creators?: { firstName?: string; lastName?: string; name?: string; creatorType?: string }[];
    abstractNote?: string; DOI?: string; url?: string; contentType?: string;
    filename?: string; parentItem?: string; [key: string]: unknown };
}
export interface Paper { item: ZoteroItem; library: string; serverId: string }
export interface NameResult { name: string; reason: string; mode: NamingMode; provider?: Provider }
export interface AttachmentRecord { key: string; filename: string; sha256: string }
export interface RecordData {
  schema: 1; library: string; key: string; serverId: string;
  attachments: AttachmentRecord[]; naming: NameResult; updated: string; pdfStatus: string;
}
export const START = '<!-- zpi:generated:start -->';
export const END = '<!-- zpi:generated:end -->';
export const FIELDS = ['title', 'authors', 'year', 'abstract', 'source_links', 'pdf_links', 'naming_reason'] as const;

export function safeName(value: string): string {
  let v = value.normalize('NFC').replace(/[\x00-\x1f\x7f/\\:*?"<>|#\[\]^]/g, '-').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '');
  // Keep names below common 255-byte filename limits, including suffixes.
  while (Buffer.byteLength(v, 'utf8') > 160) v = Array.from(v).slice(0, -1).join('');
  if (!v || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(v)) v = 'paper-' + (v || 'untitled');
  return v;
}
export function validateFolder(value: string): string {
  const p = value.trim().replace(/\\/g, '/').replace(/\/$/, '');
  if (!p || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').some(x => !x || x.startsWith('.') || /[\x00-\x1f:*?"<>|]/.test(x))) {
    throw new Error('Choose a visible folder inside the vault / 保管庫内のフォルダを指定してください。');
  }
  return p;
}
export function yearOf(item: ZoteroItem): string {
  return String(item.data.date || '').match(/\b(?:1[5-9]|20|21)\d{2}\b/)?.[0] || 'nd';
}
export function authorYear(item: ZoteroItem): string {
  const authors = item.data.creators?.filter(c => c.creatorType === 'author') || [];
  const first = authors[0];
  const surname = first?.lastName || first?.name;
  return surname ? safeName(surname.toLowerCase().replace(/\s+/g, '') + yearOf(item)) : 'item-' + item.key;
}
export function identity(paper: Paper): string { return `${paper.serverId}:${paper.library}:${paper.item.key}`; }
export function recordMatches(record: RecordData, paper: Paper): boolean {
  return record.key === paper.item.key && record.library === paper.library && record.serverId === paper.serverId;
}
export function checkedUrl(url: string): string {
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href.replace(/\(/g, '%28').replace(/\)/g, '%29') : ''; }
  catch { return ''; }
}
export function authorsOf(item: ZoteroItem): string {
  return (item.data.creators || []).filter(c => c.creatorType === 'author').map(c => c.name || [c.firstName, c.lastName].filter(Boolean).join(' ')).join(', ') || 'Unknown / 未確認';
}
export function plain(value: string): string { return value.replace(/<[^>]*>/g, '').replace(/<!--\s*zpi:/g, ''); }
export function renderGenerated(paper: Paper, record: RecordData, template: string): string {
  if (template.includes(START) || template.includes(END)) throw new Error('Template must not contain zpi managed markers.');
  const item = paper.item;
  const links = [`[Zotero](zotero://select/${paper.library === 'users/0' ? 'library' : paper.library}/items/${item.key})`];
  const doi = checkedUrl(item.data.DOI ? 'https://doi.org/' + item.data.DOI : '');
  const source = checkedUrl(item.data.url || '');
  if (doi) links.push(`[DOI](${doi})`);
  if (source) links.push(`[Original / 原文](${source})`);
  const pdfLinks = record.attachments.map(a => `[${a.filename}](./${encodeURIComponent(a.filename)})`).join('\n');
  const values: Record<string, string> = {
    title: plain(item.data.title || 'Untitled').replace(/[\r\n]+/g, ' '), authors: authorsOf(item), year: yearOf(item),
    abstract: plain(item.data.abstractNote || 'Not available / 未取得'), source_links: links.join(' · '),
    pdf_links: pdfLinks || 'PDF not downloaded / PDF未取得', naming_reason: record.naming.reason,
  };
  let body = template.replace(/\{\{([a-z_]+)\}\}/g, (match, key: string) => values[key] ?? match).trim();
  // User templates may omit these fields, but the paper must remain identifiable and readable offline.
  if (!template.includes('{{source_links}}')) body += '\n\n' + values.source_links;
  if (!template.includes('{{pdf_links}}')) body += '\n\n' + values.pdf_links;
  return START + '\n' + body.replaceAll(START, '').replaceAll(END, '') + '\n' + END;
}
export function generatedBounds(text: string): [number, number] {
  const a = text.indexOf(START), b = text.indexOf(END);
  if (a < 0 || b < a || text.indexOf(START, a + START.length) >= 0 || text.indexOf(END, b + END.length) >= 0) throw new Error('Generated markers are missing or duplicated. Keep the note and repair its markers before updating / 更新領域が不正です。');
  return [a, b + END.length];
}
export function replaceGenerated(text: string, generated: string): string {
  const [a, b] = generatedBounds(text);
  return text.slice(0, a) + generated + text.slice(b);
}
export function initialNote(paper: Paper, record: RecordData, template: string): string {
  return `---\nzpi: ${JSON.stringify(record)}\nzotero-key: ${JSON.stringify(paper.item.key)}\ncitekey: ${JSON.stringify(record.naming.name)}\npdf-status: ${JSON.stringify(record.pdfStatus)}\n---\n\n` + renderGenerated(paper, record, template) + '\n\n## My notes / 自分のメモ\n\n';
}
export function readRecord(frontmatter: unknown): RecordData | null {
  const value = (frontmatter as { zpi?: unknown } | undefined)?.zpi;
  if (!value || typeof value !== 'object') return null;
  const r = value as RecordData;
  if (r.schema !== 1 || typeof r.key !== 'string' || !/^[A-Z0-9]{8}$/.test(r.key) || !/^(users\/0|groups\/\d+)$/.test(r.library) || typeof r.serverId !== 'string' || !Array.isArray(r.attachments) || !r.naming) return null;
  for (const a of r.attachments) {
    if (!/^[A-Z0-9]{8}$/.test(a.key) || a.filename !== safeName(a.filename) || !a.filename.endsWith('.pdf') || !/^[a-f0-9]{64}$/.test(a.sha256)) return null;
  }
  return r;
}
export function parseAI(text: string): { name: string | null; reason: string; evidence: string } {
  const stripped = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  const result = JSON.parse(stripped) as Record<string, unknown>;
  if (!(result.name === null || typeof result.name === 'string') || typeof result.reason !== 'string' || typeof result.evidence !== 'string') throw new Error('AI returned an invalid naming result.');
  if (result.name !== null && (!result.name.trim() || result.name.length > 200 || !result.evidence.trim())) throw new Error('AI did not provide evidence for the proposed name.');
  return { name: result.name === null ? null : safeName(result.name), reason: result.reason.slice(0, 4000), evidence: result.evidence.slice(0, 4000) };
}
