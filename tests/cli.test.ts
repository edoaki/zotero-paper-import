import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cliCandidates, detectCLI } from '../src/cli';
import { cliGuide, guideOS } from '../src/cli-guide';

test('guide OS follows the desktop OS and leaves unknown platforms for explicit choice', () => {
  assert.equal(guideOS('darwin'), 'mac'); assert.equal(guideOS('win32'), 'windows');
  assert.equal(guideOS('linux'), 'linux'); assert.equal(guideOS('unknown'), undefined);
});
test('each CLI guide includes the correct terminal, install command, login and retry step', () => {
  for (const provider of ['codex', 'claude', 'opencode', 'antigravity'] as const) {
    const mac = cliGuide(provider, 'mac'), windows = cliGuide(provider, 'windows');
    assert.match(mac.terminal, /ターミナル/); assert.match(windows.terminal, /PowerShell/);
    assert.ok(mac.steps.some(s => s.command?.startsWith('curl ')));
    assert.ok(windows.steps.some(s => s.command?.includes(provider === 'opencode' ? 'scoop install opencode' : 'install.ps1')));
    for (const guide of [mac, windows]) {
      assert.equal(guide.steps.at(-1)?.title, 'Obsidianに戻って再検出');
      assert.equal(guide.steps.find(s => s.title === '初回ログイン')?.command, provider === 'antigravity' ? 'agy' : provider);
      assert.ok(guide.source.startsWith('https://'));
    }
  }
});
test('Windows detection finds native binaries without depending on Obsidian inheriting a new PATH', () => {
  const context = { platform:'win32', home:'C:\\Users\\Example User', env: { Path:'"C:\\Program Files\\Tools";C:\\Windows', LOCALAPPDATA:'C:\\Users\\Example User\\AppData\\Local' } };
  const agy = cliCandidates('antigravity','',context);
  assert.ok(agy.includes('C:\\Program Files\\Tools\\agy.exe'));
  assert.ok(agy.includes('C:\\Users\\Example User\\AppData\\Local\\agy\\bin\\agy.exe'));
  assert.ok(cliCandidates('claude','',context).includes('C:\\Users\\Example User\\.local\\bin\\claude.exe'));
  assert.ok(cliCandidates('opencode','',context).includes('C:\\Users\\Example User\\scoop\\shims\\opencode.exe'));
  assert.ok(agy.every(p => p.endsWith('.exe') && !p.includes('/')));
});
test('custom locations preserve spaces, expand home and do not launch Windows shell scripts', () => {
  const context = { platform:'win32',home:'C:\\Users\\Example User',env:{} };
  assert.deepEqual(cliCandidates('codex','"C:\\Tools With Spaces\\codex.exe"',context), ['C:\\Tools With Spaces\\codex.exe']);
  assert.deepEqual(cliCandidates('codex','C:\\Tools\\codex.cmd',context), ['C:\\Tools\\codex.exe']);
  assert.deepEqual(cliCandidates('claude','~/.local/bin/claude',{platform:'darwin',home:'/Users/example',env:{}}), ['/Users/example/.local/bin/claude']);
});
test('Mac detection covers graphical-app PATH gaps and maps Antigravity to agy', () => {
  const paths = cliCandidates('antigravity','',{platform:'darwin',home:'/Users/example',env:{PATH:'/usr/bin:/bin'}});
  assert.ok(paths.includes('/Users/example/.local/bin/agy')); assert.ok(paths.includes('/opt/homebrew/bin/agy'));
  assert.ok(paths.every(p=>!p.endsWith('/antigravity')));
});
test('detection rejects directories and missing files rather than claiming an installation', async () => {
  const directory = await mkdtemp(join(tmpdir(),'zpi-detection-'));
  try {
    const fake = join(directory,'executable'); await mkdir(fake);
    await assert.rejects(detectCLI('codex', fake), /見つかりません/);
    await assert.rejects(detectCLI('codex', join(directory,'missing')), /インストール手順/);
    const real = join(directory,'native'); await writeFile(real, 'fixture', {mode:0o700});
    assert.equal(await detectCLI('codex',real), real);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
