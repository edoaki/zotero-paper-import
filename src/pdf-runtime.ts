const scope = globalThis as unknown as { onmessage: (event: { data: Uint8Array }) => void; postMessage: (message: unknown) => void };

async function extract(bytes: Uint8Array): Promise<string> {
  // Both PDF.js modules run only in this isolated Web Worker.
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = worker;
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, useSystemFonts: true });
  try {
    const pdf = await task.promise;
    const sections: string[] = []; let count = 0;
    const pages = Math.min(pdf.numPages, 200);
    for (let page = 1; page <= pages; page++) {
      const p = await pdf.getPage(page);
      const text = (await p.getTextContent()).items.map(x => 'str' in x ? x.str + (x.hasEOL ? '\n' : ' ') : '').join('');
      // Reserve text across all pages, so experiment tables near the end are not silently dropped.
      const allowance = Math.floor(180_000 / pages);
      sections.push(`[PDF page ${page}${text.length > allowance ? ', excerpt' : ''}]\n${text.slice(0, allowance)}`);
      count += text.trim().length;
      p.cleanup();
    }
    if (count < 100) return 'PDF text could not be extracted (possibly scanned). No OCR was performed. Do not infer a method name from unread text.';
    if (pdf.numPages > pages) sections.push(`[Only first ${pages} of ${pdf.numPages} pages extracted.]`);
    return sections.join('\n\n');
  } finally { await task.destroy(); }
}

scope.onmessage = event => { void extract(event.data).then(
  text => scope.postMessage({ type: 'zpi-pdf-result', text }),
  error => scope.postMessage({ type: 'zpi-pdf-result', error: error instanceof Error ? error.message : String(error) }),
); };
