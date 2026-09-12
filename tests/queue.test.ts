import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SerialQueue, NeedsInput } from '../src/queue';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
function idle<T>(queue: SerialQueue<T>): Promise<void> {
  if (!queue.running) return Promise.resolve();
  return new Promise(resolve => { const off = queue.subscribe(() => { if (!queue.running) { off(); resolve(); } }); });
}
test('papers run one at a time in selection order with immutable settings snapshots', async () => {
  const gate = deferred(); const order: string[] = []; const destinations: string[] = [];
  let active = 0, maximum = 0;
  const queue = new SerialQueue<{ destination: string }>(async job => {
    maximum = Math.max(maximum, ++active); order.push(job.key); destinations.push(job.payload.destination);
    if (job.key === 'first') await gate.promise;
    active--; return job.key + '.md';
  });
  const settings = { destination: 'Original' };
  const first = queue.add('first', 'First', settings);
  const second = queue.add('second', 'Second', settings);
  settings.destination = 'Changed later';
  assert.equal(first.state, 'running'); assert.equal(second.state, 'queued');
  gate.resolve(); await idle(queue);
  assert.deepEqual(order, ['first', 'second']); assert.deepEqual(destinations, ['Original', 'Original']); assert.equal(maximum, 1);
  assert.equal(second.path, 'second.md');
});
test('selecting the same active paper twice does not enqueue a duplicate', async () => {
  const gate = deferred(); let count = 0;
  const queue = new SerialQueue(async () => { count++; await gate.promise; });
  const first = queue.add('paper', 'Paper', {});
  assert.equal(queue.add('paper', 'Paper', {}), first);
  assert.equal(queue.jobs.length, 1); gate.resolve(); await idle(queue); assert.equal(count, 1);
});
test('cancelling a queued job skips it without affecting other jobs', async () => {
  const gate = deferred(); const ran: string[] = [];
  const queue = new SerialQueue(async job => { ran.push(job.key); if (job.key === 'a') await gate.promise; });
  queue.add('a', 'A', {}); const b = queue.add('b', 'B', {}); queue.add('c', 'C', {});
  queue.cancel(b.id); gate.resolve(); await idle(queue);
  assert.deepEqual(ran, ['a', 'c']); assert.equal(b.state, 'cancelled');
});
test('active cancellation advances the queue; committing tasks cannot be cancelled', async () => {
  const gate = deferred();
  const queue = new SerialQueue(async (job, progress) => {
    if (job.key === 'cancel') await new Promise<void>((_, reject) => progress.controller.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    else { progress.commit(); await gate.promise; return 'saved.md'; }
  });
  const first = queue.add('cancel', 'Cancel', {}); const second = queue.add('save', 'Save', {});
  queue.cancel(first.id);
  await new Promise<void>(resolve => { const off = queue.subscribe(() => { if (second.committing) { off(); resolve(); } }); });
  queue.cancel(second.id); assert.equal(second.state, 'running'); gate.resolve(); await idle(queue);
  assert.equal(first.state, 'cancelled'); assert.equal(second.state, 'completed');
});
test('a failed or confirmation-waiting paper does not block later papers; retry uses the tail', async () => {
  const order: string[] = [];
  const queue = new SerialQueue<{ confirmed?: boolean }>(async job => {
    order.push(job.key);
    if (job.key === 'confirm' && !job.payload.confirmed) throw new NeedsInput('Select PDF', { kind: 'select-pdf' });
    if (job.key === 'fail') throw new Error('No connection');
    return 'saved.md';
  });
  const confirm = queue.add('confirm', 'Confirm', {}); queue.add('fail', 'Fail', {}); const good = queue.add('good', 'Good', {});
  await idle(queue); assert.equal(confirm.state, 'needs-input'); assert.equal(good.state, 'completed');
  queue.retry(confirm.id, p => { p.confirmed = true; }); await idle(queue);
  assert.deepEqual(order, ['confirm', 'fail', 'good', 'confirm']); assert.equal(confirm.state, 'completed');
});
test('closing a view does not cancel work; interrupted jobs survive restart without automatically spending AI usage', async () => {
  const gate = deferred(); const queue = new SerialQueue(async () => { await gate.promise; });
  let updates = 0; const off = queue.subscribe(() => updates++);
  const job = queue.add('paper', 'Paper', {}); off();
  const saved = structuredClone(queue.jobs); gate.resolve(); await idle(queue);
  assert.equal(job.state, 'completed'); assert.ok(updates > 0);
  let ran = false; const restored = new SerialQueue(async () => { ran = true; });
  restored.restore(saved); assert.equal(restored.jobs[0].state, 'failed'); assert.equal(ran, false);
  restored.retry(restored.jobs[0].id); await idle(restored); assert.equal(ran, true);
});
test('retry cannot duplicate another active job for the same paper', async () => {
  const gate = deferred(); let calls = 0;
  const queue = new SerialQueue(async () => { if (++calls === 1) throw new Error('first failure'); await gate.promise; });
  const failed = queue.add('same', 'Same', {}); await idle(queue);
  const next = queue.add('same', 'Same', {}); queue.retry(failed.id);
  assert.equal(failed.state, 'failed'); assert.equal(next.state, 'running');
  gate.resolve(); await idle(queue); assert.equal(calls, 2);
});
