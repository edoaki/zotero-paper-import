# Design

The core operation is one desktop Obsidian command: search a local Zotero library, choose a paper and its PDF attachments, determine its name, and save a per-paper directory containing an identically named Markdown note and locally readable PDF copies.

## Boundaries

- Local Zotero API over HTTP loopback only; all requests are GET.
- Zotero 10+ supplies a database server identifier. Local paper identity is `(server ID, library route, item key)`; filenames are mutable labels. Cross-database reconciliation is deliberately not automatic.
- Vault APIs own file creation and link-aware renames. The configurable destination applies to new imports. Existing imported notes are located throughout the vault, including manually moved notes.
- The plugin owns PDF copying, output validation, deduplication and note generation. AI returns a proposed name and evidence; it does not manage files.
- No external Python scripts, Obsidian CLI, ZotLit or Zotero add-on is needed at runtime. Optional AI CLIs remain separately installed and authenticated by the user.

## Storage

The Markdown note holds a `zpi` frontmatter record with the database/library/item identity, tracked attachment keys/filenames/hashes, naming decision and last update. This travels with the note through vault moves and sync. The note's `citekey` is a vault-local label. Generated content is bounded by explicit markers; personal writing lives outside them.

The first selected PDF is `本文.pdf`, further attachments are `添付-<attachment-key>.pdf`. PDFs are validated for a PDF header and SHA-256 verified after writing. Updating an externally edited copy is refused. Updates retain backups under the plugin's vault configuration directory. Settings contain no credentials; the executable path and local port are per-device local storage.

## Naming

Default: first author surname + publication year. AI modes: built-in method-name rule or saved custom prompt. Paper text is extracted by bundled PDF.js. AI results must provide a name (or null), reason and evidence. Folder names are normalized, invalid path characters removed, Windows device names avoided, UTF-8 byte length bounded, and collisions receive suffixes.

## UI

The setup guide checks connection and gives actionable errors. The paper picker supports library selection and debounced title/author/year search, with bounded concurrent attachment checks. A progress modal supports cancellation during retrieval/AI. Once committing files starts, the short commit is allowed to finish to avoid partial cancellation. Naming changes only affect new imports unless an explicit rename command is run.

## Initial release scope

macOS desktop validation; generated files can be synced and read on iPad. No classification, summaries, automatic background sync, citation-key write-back, or annotation editor. OpenCode adapter is experimental until tested against an authenticated installation. The project is distributed through GitHub Releases, without community-directory submission.
