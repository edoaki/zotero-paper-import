# Validation for 0.1.0

Checked on 2026-09-12. This describes observed results, not a guarantee across all installations.

## Automated checks

`npm run check` runs strict TypeScript checking, 15 behavioral tests, and a release build. Tests cover:

- Per-paper folder/note/PDF creation and reimport deduplication.
- Identity recognition after a manual vault move or changed destination.
- Case-insensitive name collisions between different papers.
- Refusing to silently merge the same key from different Zotero databases.
- Preserving personal notes during metadata/PDF refresh.
- Refusing to overwrite a locally modified PDF before any update writes.
- Cleanup of this operation's PDF copies when note creation fails.
- Note-only imports and adding a previously missing PDF through refresh.
- Concurrent note edits: preserve the edit and roll back this operation's PDF update.
- Safe path/name handling, Unicode byte limits, missing author/year.
- Structured AI result validation, evidence requirement.
- Local connection diagnostics and database identity continuity.
- CLI stdin handling without shell interpolation, timeout and cancellation.

Fixtures are synthetic. No user's library, notes, PDFs, credentials, or local paths are included in the source repository.

## Live desktop checks

Environment: macOS, Obsidian 1.13.7 (installer 1.13.7), Zotero 10.0.2. Used a separate test vault with only this plugin installed.

- Plugin loads, appears in community settings, and registers its commands.
- Connection test reaches the local Zotero API and reads the library without API credentials.
- Search modal lists papers and PDF attachment availability; title search narrows the list.
- Selecting a paper creates a note and PDF copy in the chosen destination.
- Obsidian's resolved-link index points from the generated note to its sibling vault PDF.
- Refresh completes on an unmodified note/PDF.
- Codex connection test returns valid structured output.
- PDF.js extracts the actual paper; Codex identifies its proposed method and returns evidence with a PDF page. Explicit rename changes the folder and note name accordingly. The PDF link still resolves.
- Reimport identity lookup finds the renamed note without creating another note.
- The copied PDF opens in Obsidian's built-in PDF view.

## Not yet validated

- Claude Code: executable found; the live test stopped at authentication. The adapter is implemented; successful authenticated generation has not been verified in this environment.
- OpenCode: CLI not installed here. Adapter implemented against official non-interactive CLI documentation, marked experimental.
- iPad / iCloud: the output is ordinary Markdown and PDF, but an actual iPad offline/sync test has not been performed. Test this before relying on it while traveling.
- Windows and Linux: not tested. CLI discovery is primarily for macOS/Linux. Windows npm `.cmd` launchers are not supported by the no-shell runner in this beta.
- Very large libraries, group libraries with restrictive permissions, scan-heavy PDFs, long-running interrupted imports, and multi-desktop synchronization races need wider beta testing.

## Suggested beta test

Use a fresh vault, import one open-access paper with author/year naming, click its local PDF link, reimport it, add a personal note, and refresh. Then try method naming if you have a supported CLI. Sync the vault to an iPad, ensure the files are downloaded, disconnect the network, and open the PDF from the note. Report the application versions and observed behavior, without attaching credentials or private PDFs.
