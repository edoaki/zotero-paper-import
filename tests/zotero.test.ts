import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ZoteroClient, localRequest, ConnectionError } from '../src/zotero';

test('connection distinguishes disabled API and incompatible version; validates database continuity', async () => {
  let status = 403, sid = 'example';
  const server = http.createServer((req, res) => {
    assert.equal(req.method, 'GET');
    res.statusCode = status;
    if (sid) res.setHeader('Zotero-Server-ID', sid);
    res.setHeader('Zotero-Version', '10.0.2');
    res.end('[]');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    const port = (server.address() as { port: number }).port;
    const client = new ZoteroClient(port);
    await assert.rejects(client.probe(), e => e instanceof ConnectionError && e.kind === 'disabled');
    status = 200; sid = '';
    await assert.rejects(client.probe(), e => e instanceof ConnectionError && e.kind === 'version');
    sid = 'example'; await client.probe(); assert.equal(client.serverId, 'example');
    sid = 'other'; await assert.rejects(client.get('/users/0/items'), /変わ/);
  } finally { server.close(); }
});
test('local transport refuses arbitrary addresses and paths', async () => {
  await assert.rejects(localRequest(0, '/api/'));
  await assert.rejects(localRequest(23119, 'https://example.com'));
});
