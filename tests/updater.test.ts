import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installUpdate, newer, prepareUpdate, UPDATE_FILES, UPDATE_REPO } from '../src/updater';
const encode = (data: unknown) => Buffer.from(JSON.stringify(data));
function release() {
  const files = {
    'main.js': Buffer.from('module.exports = {};\n' + '// valid plugin bundle\n'.repeat(10)),
    'styles.css': Buffer.from('.zpi { color: inherit; }'),
    'manifest.json': encode({ id: 'zotero-paper-import', version: '0.3.2', minAppVersion: '1.13.4' }),
  };
  const metadata = { tag_name: '0.3.2', draft: false, prerelease: false, assets: UPDATE_FILES.map(name => ({ name, size: files[name].length, digest: `sha256:${createHash('sha256').update(files[name]).digest('hex')}`, browser_download_url: `https://github.com/${UPDATE_REPO}/releases/download/0.3.2/${name}` })) };
  const download = async (url: string) => url.endsWith('/latest') ? encode(metadata) : files[url.split('/').at(-1) as keyof typeof files];
  return { files, metadata, download };
}
test('release update compares numeric versions and never downgrades or installs prereleases', async () => {
  assert.equal(newer('0.10.0', '0.9.9'), true);
  assert.equal(newer('0.3.2', '0.3.2'), false);
  assert.throws(() => newer('0.3.2-beta', '0.3.1'));
  const r = release();
  assert.equal(await prepareUpdate('0.4.0', '1.13.7', r.download), null);
  assert.equal(await prepareUpdate('0.3.2', '1.13.7', r.download), null);
  r.metadata.prerelease = true;
  await assert.rejects(prepareUpdate('0.3.1', '1.13.7', r.download), /正式リリース/);
});
test('update validates trusted assets, checksum, plugin identity and minimum Obsidian version', async () => {
  const good = release();
  assert.equal((await prepareUpdate('0.3.1', '1.13.7', good.download))?.version, '0.3.2');
  await assert.rejects(prepareUpdate('0.3.1', '1.12.0', good.download), /先にObsidian/);
  const corrupt = release(); corrupt.files['main.js'][0] ^= 1;
  await assert.rejects(prepareUpdate('0.3.1', '1.13.7', corrupt.download), /検証に失敗/);
  const untrusted = release(); untrusted.metadata.assets[0].browser_download_url = 'https://example.com/main.js';
  await assert.rejects(prepareUpdate('0.3.1', '1.13.7', untrusted.download), /配布元/);
  const missing = release(); missing.metadata.assets.pop();
  await assert.rejects(prepareUpdate('0.3.1', '1.13.7', missing.download), /ありません/);
  const identity = release(); identity.files['manifest.json'] = encode({ id: 'another-plugin', version: '0.3.2', minAppVersion: '1.13.4' });
  const asset = identity.metadata.assets.find(a => a.name === 'manifest.json')!;
  asset.size = identity.files['manifest.json'].length;
  asset.digest = `sha256:${createHash('sha256').update(identity.files['manifest.json']).digest('hex')}`;
  await assert.rejects(prepareUpdate('0.3.1', '1.13.7', identity.download), /一致しません/);
});
test('installation backs up existing files, preserves settings and history, and commits manifest last', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zpi-update-'));
  try {
    const plugin = join(root, 'plugin'); await mkdir(plugin);
    const old = { 'main.js': 'old js', 'styles.css': 'old css', 'manifest.json': JSON.stringify({ id: 'zotero-paper-import', version: '0.3.1' }) };
    for (const name of UPDATE_FILES) await writeFile(join(plugin, name), old[name]);
    await writeFile(join(plugin, 'data.json'), 'private settings');
    await writeFile(join(plugin, 'organization-history.json'), 'history');
    const r = release(), plan = (await prepareUpdate('0.3.1', '1.13.7', r.download))!;
    const order: string[] = [];
    const backup = await installUpdate(plugin, join(root, 'backups'), plan, () => true, async (from, to) => { order.push(String(to).split('/').at(-1)!); await rename(from, to); });
    assert.deepEqual(order, [...UPDATE_FILES]);
    for (const name of UPDATE_FILES) {
      assert.deepEqual(await readFile(join(plugin, name)), r.files[name]);
      assert.equal(await readFile(join(backup, 'original', name), 'utf8'), old[name]);
    }
    assert.equal(await readFile(join(plugin, 'data.json'), 'utf8'), 'private settings');
    assert.equal(await readFile(join(plugin, 'organization-history.json'), 'utf8'), 'history');
    assert.equal(await readFile(join(backup, 'original', 'data.json'), 'utf8'), 'private settings');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('partial install failure rolls back; active jobs prevent installation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zpi-rollback-'));
  try {
    const plugin = join(root, 'plugin'); await mkdir(plugin);
    const old = { 'main.js': 'old js', 'styles.css': 'old css', 'manifest.json': JSON.stringify({ id: 'zotero-paper-import', version: '0.3.1' }) };
    for (const name of UPDATE_FILES) await writeFile(join(plugin, name), old[name]);
    const r = release(), plan = (await prepareUpdate('0.3.1', '1.13.7', r.download))!;
    await assert.rejects(installUpdate(plugin, join(root, 'backups'), plan, () => false), /処理が終わって/);
    let count = 0;
    await assert.rejects(installUpdate(plugin, join(root, 'backups'), plan, () => true, async (from, to) => {
      if (++count === 2) throw new Error('simulated disk failure');
      await rename(from, to);
    }), /元の版を保持/);
    for (const name of UPDATE_FILES) assert.equal(await readFile(join(plugin, name), 'utf8'), old[name]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
