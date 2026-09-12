export type JobState = 'queued' | 'running' | 'needs-input' | 'completed' | 'failed' | 'cancelled';
export interface QueueJob<T> {
  id: string; key: string; title: string; payload: T; state: JobState;
  progress: string; path?: string; error?: string; input?: unknown; committing?: boolean;
}
export interface JobProgress {
  controller: AbortController;
  update(message: string): void;
  commit(): void;
}
export class NeedsInput extends Error {
  constructor(message: string, public input: unknown) { super(message); }
}
export const JOB_LABELS: Record<JobState, string> = {
  queued: '待機中', running: '処理中', 'needs-input': '確認待ち', completed: '完了', failed: '失敗', cancelled: 'キャンセル済み',
};

/** One worker, FIFO order. Payloads are snapshots, not live settings objects. */
export class SerialQueue<T> {
  readonly jobs: QueueJob<T>[] = [];
  private listeners = new Set<() => void>();
  private active?: { job: QueueJob<T>; controller: AbortController };
  private working = false;
  private disposed = false;
  constructor(private process: (job: QueueJob<T>, progress: JobProgress) => Promise<string | void>) {}
  get running(): boolean { return this.working; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(): void { for (const listener of this.listeners) { try { listener(); } catch { /* UI errors must not stop the worker */ } } }
  latest(key: string): QueueJob<T> | undefined { return [...this.jobs].reverse().find(job => job.key === key); }
  add(key: string, title: string, payload: T): QueueJob<T> {
    if (this.disposed) throw new Error('プラグインを読み込み直してください。');
    const existing = this.latest(key);
    if (existing && ['queued', 'running', 'needs-input'].includes(existing.state)) return existing;
    const job: QueueJob<T> = { id: crypto.randomUUID(), key, title, payload: structuredClone(payload), state: 'queued', progress: '順番を待っています' };
    this.jobs.push(job); this.emit(); void this.drain(); return job;
  }
  cancel(id: string): void {
    const job = this.jobs.find(j => j.id === id);
    if (!job || job.committing || !['queued', 'running', 'needs-input'].includes(job.state)) return;
    if (job.state === 'running') { this.active?.controller.abort(); job.progress = 'キャンセルしています…'; }
    else { job.state = 'cancelled'; job.progress = 'キャンセルしました'; }
    this.emit();
  }
  retry(id: string, change?: (payload: T) => void): void {
    const job = this.jobs.find(j => j.id === id);
    if (!job || !['needs-input', 'failed', 'cancelled'].includes(job.state) || this.disposed) return;
    if (this.jobs.some(other => other !== job && other.key === job.key && ['queued', 'running', 'needs-input'].includes(other.state))) return;
    // Resolved confirmations and retries join the tail without blocking other papers.
    this.jobs.splice(this.jobs.indexOf(job), 1); this.jobs.push(job);
    change?.(job.payload); job.state = 'queued'; job.progress = '順番を待っています';
    delete job.error; delete job.input; delete job.committing;
    this.emit(); void this.drain();
  }
  clearFinished(): void {
    for (let i = this.jobs.length - 1; i >= 0; i--) if (['completed', 'cancelled'].includes(this.jobs[i].state)) this.jobs.splice(i, 1);
    this.emit();
  }
  restore(jobs: QueueJob<T>[]): void {
    for (const saved of jobs) {
      const job = structuredClone(saved); delete job.committing;
      if (job.state === 'queued' || job.state === 'running') {
        job.state = 'failed'; job.error = '前回の終了時に中断しました。「再試行」で続けられます。'; job.progress = '中断';
      }
      this.jobs.push(job);
    }
    this.emit();
  }
  dispose(): void { this.disposed = true; this.active?.controller.abort(); this.listeners.clear(); }
  private async drain(): Promise<void> {
    if (this.working || this.disposed) return;
    this.working = true;
    try {
      let job: QueueJob<T> | undefined;
      while (!this.disposed && (job = this.jobs.find(j => j.state === 'queued'))) {
        const current = job; const controller = new AbortController(); this.active = { job: current, controller };
        current.state = 'running'; current.progress = '準備中…'; this.emit();
        try {
          const path = await this.process(current, {
            controller,
            update: text => { current.progress = text; this.emit(); },
            commit: () => { current.committing = true; this.emit(); },
          });
          if (controller.signal.aborted && !current.committing) { current.state = 'cancelled'; current.progress = 'キャンセルしました'; }
          else { current.path = path || undefined; current.state = 'completed'; current.progress = '保存しました'; }
        } catch (e) {
          if (controller.signal.aborted && !current.committing) { current.state = 'cancelled'; current.progress = 'キャンセルしました'; }
          else if (e instanceof NeedsInput) { current.state = 'needs-input'; current.input = e.input; current.progress = e.message; }
          else { current.state = 'failed'; current.error = e instanceof Error ? e.message : String(e); current.progress = '処理できませんでした'; }
        }
        delete current.committing; this.active = undefined; this.emit();
      }
    } finally { this.working = false; this.emit(); }
  }
}
