import type { Provider } from './core';

export type GuideOS = 'mac' | 'windows' | 'linux';
export const OS_LABELS: Record<GuideOS, string> = { mac: 'Mac', windows: 'Windows', linux: 'Linux' };
export const CLI_NAMES: Record<Provider, string> = { codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode', antigravity: 'Antigravity CLI' };
export const CLI_COMMANDS: Record<Provider, string> = { codex: 'codex', claude: 'claude', opencode: 'opencode', antigravity: 'agy' };
export function guideOS(platform: string): GuideOS | undefined {
  return platform === 'darwin' ? 'mac' : platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : undefined;
}
export interface GuideStep { title: string; description: string; command?: string; link?: { label: string; url: string } }
export interface CLIGuide { terminal: string; steps: GuideStep[]; source: string }
export function cliGuide(provider: Provider, os: GuideOS): CLIGuide {
  const windows = os === 'windows';
  const command = CLI_COMMANDS[provider];
  const terminal = windows ? 'スタートメニューで「PowerShell」を検索して開きます。通常の起動で構いません。Windows版Obsidianから使うので、WSLではなくPowerShellで導入してください。'
    : os === 'mac' ? '⌘＋スペースで「ターミナル」を検索して開きます。下のコマンドをコピーして貼り付け、Enterを押してください。'
    : 'ターミナルを開き、下のコマンドをコピーして貼り付け、Enterを押してください。';
  const install: Record<Provider, string> = {
    codex: windows ? 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"' : 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
    claude: windows ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash',
    antigravity: windows ? 'irm https://antigravity.google/cli/install.ps1 | iex' : 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    opencode: windows ? 'scoop install opencode' : 'curl -fsSL https://opencode.ai/install | bash',
  };
  const source: Record<Provider, string> = {
    codex: 'https://learn.chatgpt.com/docs/codex/cli', claude: 'https://code.claude.com/docs/en/setup',
    antigravity: 'https://antigravity.google/docs/cli/install/', opencode: 'https://opencode.ai/docs/',
  };
  const steps: GuideStep[] = [];
  if (windows && provider === 'opencode') steps.push({ title: 'Scoopがない場合だけ準備',
    description: 'WindowsではScoopを使って導入します。既にScoopを使っている場合は次へ進んでください。1行目は現在のユーザーのPowerShell実行ポリシーをRemoteSignedに設定します。',
    command: 'Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser\nirm https://get.scoop.sh | iex',
    link: { label: 'Scoopの公式導入手順', url: 'https://github.com/ScoopInstaller/Install' } });
  steps.push({ title: `${CLI_NAMES[provider]}をインストール`, description: 'コマンドを貼り付けて実行し、完了するまで待ちます。', command: install[provider] });
  steps.push({ title: '初回ログイン', description: provider === 'opencode'
    ? 'ターミナルを開き直して下のコマンドを実行し、OpenCodeの画面内で /connect と入力して利用するAIを接続します。'
    : `ターミナルを開き直して下のコマンドを実行し、${provider === 'antigravity' ? 'Googleアカウントの' : ''}ログイン案内に従ってください。`, command });
  steps.push({ title: 'Obsidianに戻って再検出', description: '下の「再検出」を押し、「検出済み」になったら「AI接続テスト」を実行します。見つからなければObsidianを終了して開き直すか、「CLIの場所を指定」で実行ファイルを指定してください。' });
  return { terminal, steps, source: source[provider] };
}
