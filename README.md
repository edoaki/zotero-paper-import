# Zotero Paper Import

Import a paper from Zotero into a vault folder containing a Markdown note and PDF files. Pick a destination, run one Obsidian command, and select a paper. Optional AI naming uses your installed Codex, Claude Code, or OpenCode CLI.

**Early desktop beta — v0.1.0.** macOS is the initial tested platform. Requires Zotero **10+** and Obsidian **1.13.4+**. The plugin is not submitted to the Obsidian community directory yet.

[日本語の使い方](docs/README.ja.md) · [Design](docs/DESIGN.md) · [Testing](docs/TESTING.md)

```text
Your chosen folder/
└── smith2025/             # or an AI-verified method name
    ├── smith2025.md
    ├── 本文.pdf            # main paper
    └── 添付-XXXXXXXX.pdf  # optional supplement
```

## Install

1. Download `zotero-paper-import-0.1.0.zip` from [Releases](https://github.com/edoaki/zotero-paper-import/releases).
2. Extract it. Copy the enclosed `zotero-paper-import` folder into `<your-vault>/.obsidian/plugins/`.
3. In Obsidian → Settings → Community plugins, enable **Zotero Paper Import**. Reopen Obsidian if it does not appear.
4. In Zotero → Settings → Advanced, enable **Allow other applications on this computer to communicate with Zotero**. Keep Zotero open.
5. Open the plugin settings, click **Check connection**, and choose/type a destination inside your vault.

Start with a separate test vault. No Python, Obsidian CLI, Better BibTeX, ZotLit, Zotero companion add-on, or Zotero API key is required. Node.js is only needed to build from source, not to use the plugin.

## Use

- Run **Zotero Paper Import: Import paper from Zotero** (or click the download ribbon icon).
- Search by title, author, or year. Select a paper. If it has multiple PDFs, select a primary PDF and the attachments to copy.
- The folder, note, and verified PDF copies are created; the note opens automatically.
- Selecting the same paper again opens its existing note, even after a move inside the vault.
- Run **Refresh this paper** from an imported note to update generated metadata and previously selected PDFs. Write personal notes **outside** `<!-- zpi:generated:start -->` and `<!-- zpi:generated:end -->`.
- Run **Apply naming settings to this paper** to explicitly rename an existing paper using the current rule. New settings do not automatically rename old papers.

Imports read Zotero only. No records, citation keys, attachments, or original PDFs are changed in Zotero. The `citekey` in the generated note is a local name, not a write-back to Zotero/Better BibTeX.

## Naming

| Mode | Behavior |
| --- | --- |
| Author + year (default) | No AI. First author surname plus Zotero's publication year. Missing year → `nd`; missing author → `item-<Zotero key>`. |
| Method name | AI examines metadata and extracted PDF text for the method/model newly proposed by the paper. Evidence is saved in the note. |
| Custom rule | Save and select plain-language naming rules. Duplicate, export, and import rule files. |

AI output is validated and sanitized before use as a folder name. Different papers with the same name receive numeric suffixes. If AI fails or finds no supported name, the default is author + year with the reason recorded. You can instead request manual naming.

## Optional AI setup

Choose an AI naming mode, select a CLI, and use **Detect** and **Test AI connection**. Install and log in to your chosen CLI in a terminal first. Set a model if needed. CLI executable paths are stored per device, not in synced plugin settings. Authentication stays with the CLI.

| CLI | Integration |
| --- | --- |
| Codex | `codex exec`, read-only sandbox, ephemeral run, structured output. Requires a recent CLI supporting `--ignore-user-config`; uses existing authentication but skips personal config/MCP. Specify your model in plugin settings if needed. |
| Claude Code | Non-interactive structured output; built-in tools and MCP disabled, hooks disabled for the invocation, no session persistence. |
| OpenCode | Non-interactive JSON output with a dedicated no-tools agent. Experimental; install/authenticate separately. |

An AI invocation runs in a temporary working directory, not in your vault. The plugin sends only the selected paper's metadata, extracted text, and naming instruction. It does not give AI file-writing responsibilities. The invocation directory is removed afterward. CLI-owned configuration, logging, and providers remain governed by that CLI.

PDF extraction is bundled. No OCR is performed. At most 200 pages and approximately 180,000 text characters are supplied, with excerpts marked by page. A difficult scan or table can cause fallback or an incorrect AI suggestion; evidence is included so you can check it. AI processing requires whatever network/model access your chosen CLI uses; costs and usage limits apply. The connection test sends a short synthetic prompt and can also consume usage.

## Offline reading and iPad

The plugin runs on desktop. The generated notes and PDFs are ordinary vault files and can be read on iPad **without this plugin**, after your chosen sync service (for example iCloud) downloads them to the device. This plugin does not implement cloud sync or ensure files remain downloaded. Verify by opening the PDF from its note with the iPad offline.

## Updates and safety behavior

- Missing PDFs are reported; saving only a note is an explicit choice. A later refresh can add the downloaded attachment.
- For multiple attachments, a failed download stops the PDF set from being saved as a complete import; you may save a note only and retry later.
- Refresh stops if a vault copy has changed since import, protecting external annotations/handwriting.
- Refresh backs up the note and existing PDFs to `.obsidian/plugins/zotero-paper-import/backups/` (or your custom configuration directory). These backups are not automatically pruned. Review and remove them manually when no longer needed.
- Existing tracked attachments are kept if their Zotero counterparts disappear; refresh stops for manual review.
- Local Zotero database identity is recorded. A different database with the same item key is not silently treated as the same paper. This beta expects imports/refreshes from one Zotero database; multi-desktop database reconciliation is not implemented.
- Move/rename through Obsidian with automatic link updates enabled. Do not delete `zpi` properties or generated-region markers. Edit personal notes outside the generated region.

## Limits of this beta

One paper per import; PDF attachments up to 128 MiB each; search shows the newest 100 matches (refine the query for more). Refresh updates previously selected attachments; adding newly attached supplements to an already-imported PDF set is not yet exposed. Windows/Linux packaging is not validated. AI naming via local CLI runs on desktop only. Bibliographic values are taken from Zotero; incorrect Zotero metadata remains incorrect until corrected there. No automatic classification, generated summaries, Zotero write-back, or Zotero annotation extraction.

## Privacy

Zotero requests use GET against `127.0.0.1` only. PDF file locations come from that local API; the plugin reads those specific files to copy them into the vault. AI naming sends paper content to the provider configured in the selected CLI. No telemetry or analytics. No API keys are requested or stored by this plugin. Shared settings contain destination, template, naming rules, provider/model preferences; device settings contain CLI path and local API port. Backups and notes contain bibliographic data. Treat CLI logs and vault sync according to your own privacy settings.

## Build

```sh
npm ci
npm run check
npm run package
```

Requires a current Node.js 22+ development environment. Build output is in `dist/`, the distributable ZIP in `release/`. Develop in a dedicated test vault. See [testing notes](docs/TESTING.md) for what has actually been checked.

## License and credits

MIT © 2026 edoaki. PDF text extraction bundles Mozilla PDF.js (`pdfjs-dist`), Apache-2.0; its license is included in `THIRD-PARTY-LICENSES.txt`. This is an independent project, not an official Zotero or Obsidian product.
