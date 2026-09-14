
// Injected by the build: a self-contained bundle, never evaluated in the renderer.
declare const __ZPI_PDF_WORKER_SOURCE__: string;
export function extractPDF(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(new Error('キャンセルしました'));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([__ZPI_PDF_WORKER_SOURCE__], { type: 'text/javascript' }));
    let worker: Worker;
    try { worker = new Worker(url); }
    catch (error) { URL.revokeObjectURL(url); reject(error); return; }
    let settled = false;
    const finish = (error?: Error, text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
      URL.revokeObjectURL(url);
      error ? reject(error) : resolve(text!);
    };
    const cancel = () => finish(new Error('キャンセルしました'));
    const timer = setTimeout(() => finish(new Error('PDFの本文抽出が時間切れになりました。')), 120_000);
    worker.onmessage = event => {
      const message: unknown = event.data;
      // PDF.js may emit its own worker-ready notification during module loading.
      if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'zpi-pdf-result') return;
      if (message && typeof message === 'object' && 'text' in message && typeof message.text === 'string') finish(undefined, message.text);
      else if (message && typeof message === 'object' && 'error' in message && typeof message.error === 'string') finish(new Error(`PDFの本文抽出に失敗しました: ${message.error}`));
      else finish(new Error('PDFの本文抽出から不正な応答を受け取りました。'));
    };
    worker.onerror = event => { event.preventDefault(); finish(new Error(event.message || 'PDFの本文抽出に失敗しました。')); };
    worker.onmessageerror = () => finish(new Error('PDFの本文抽出の応答を読み取れませんでした。'));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    else {
      try { worker.postMessage(new Uint8Array(bytes)); }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    }
  });
}
