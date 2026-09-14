import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Worker as NodeWorker } from 'node:worker_threads';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// Node test adapter; the identical browser bundle is also checked in Obsidian.
class BrowserWorker {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string; preventDefault(): void }) => void;
  onmessageerror?: () => void;
  private worker?: NodeWorker;
  private stopped = false;
  private ready: Promise<void>;
  constructor(url: string) {
    this.ready = fetch(url).then(response => response.text()).then(source => {
      if (this.stopped) return;
      this.worker = new NodeWorker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=data=>parentPort.postMessage(data);parentPort.on('message',data=>globalThis.onmessage({data}));\n${source}`, { eval: true });
      this.worker.on('message', data => this.onmessage?.({ data }));
      this.worker.on('error', error => this.onerror?.({ message: error.message, preventDefault() {} }));
    });
  }
  postMessage(data: Uint8Array) { void this.ready.then(() => { if (!this.stopped) this.worker!.postMessage(data); }); }
  terminate() { this.stopped = true; void this.worker?.terminate(); }
}

// A generated, valid PDF: no private papers are used in regression tests.
function fixture(): Uint8Array {
  const content = `BT /F1 12 Tf 30 100 Td (${ 'Independent PDF extraction preserves the host viewer. '.repeat(4) }) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test('isolated bundled extraction preserves host PDF globals on success, failure and cancellation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zpi-pdf-test-'));
  const host = globalThis as Record<string, unknown>;
  const originalWorker = Object.getOwnPropertyDescriptor(host, 'Worker');
  Object.defineProperty(host, 'Worker', { configurable: true, value: BrowserWorker });
  const keys = ['pdfjsLib', 'pdfjsWorker', '_pdfjsTestingUtils'];
  const originals = keys.map(key => Object.getOwnPropertyDescriptor(host, key));
  const sentinels = keys.map((key, index) => Object.freeze({ key, version: `host-future-${index}` }));
  try {
    const runtime = await build({ entryPoints: ['src/pdf-runtime.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022', external: ['node:*'] });
    const output = join(dir, 'bridge.cjs');
    await build({ entryPoints: ['src/pdf.ts'], outfile: output, bundle: true, platform: 'node', format: 'cjs', define: { __ZPI_PDF_WORKER_SOURCE__: JSON.stringify(runtime.outputFiles[0].text) } });
    keys.forEach((key, index) => Object.defineProperty(host, key, { configurable: true, writable: false, value: sentinels[index] }));
    const { extractPDF } = createRequire(import.meta.url)(output) as typeof import('../src/pdf');
    const bytes = fixture(); const copy = Buffer.from(bytes);
    const texts = await Promise.all([extractPDF(bytes), extractPDF(bytes)]);
    texts.forEach(text => assert.match(text, /Independent PDF extraction preserves the host viewer/));
    assert.deepEqual(bytes, copy);
    await assert.rejects(extractPDF(Buffer.from('invalid PDF')), /PDFの本文抽出に失敗/);
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(extractPDF(bytes, cancelled.signal), /キャンセル/);
    const active = new AbortController(); const pending = extractPDF(bytes, active.signal); active.abort();
    await assert.rejects(pending, /キャンセル/);
    keys.forEach((key, index) => assert.equal(host[key], sentinels[index]));
    // The host need not have initialized its own viewer yet.
    keys.forEach(key => { delete host[key]; });
    assert.match(await extractPDF(bytes), /Independent PDF extraction/);
    keys.forEach(key => assert.equal(Object.hasOwn(host, key), false));
  } finally {
    if (originalWorker) Object.defineProperty(host, 'Worker', originalWorker); else delete host.Worker;
    keys.forEach((key, index) => { const original = originals[index]; if (original) Object.defineProperty(host, key, original); else delete host[key]; });
    await rm(dir, { recursive: true, force: true });
  }
});
