import { validateFolder, type Settings } from './core';

export function migrateLayout(settings: Settings): Settings {
  if (settings.layoutVersion === 1) return settings;
  let root = settings.organizeRoot || settings.folder;
  let oldInbox = settings.organizeInbox || (root ? root + '/未整理' : '');
  if (!settings.organizeRoot && !settings.organizeInbox && root.endsWith('/未整理')) { oldInbox = root; root = root.slice(0, root.lastIndexOf('/')); }
  if (oldInbox === root && root.includes('/')) root = root.slice(0, root.lastIndexOf('/'));
  const inboxName = oldInbox.startsWith(root + '/') ? oldInbox.slice(root.length + 1) : '未整理';
  return { ...settings, folder: root, inboxName, layoutVersion: 1,
    legacyFolders: [...new Set([...(settings.legacyFolders || []), settings.folder, settings.organizeRoot, settings.organizeInbox].filter(Boolean))],
    organizeRoot: '', organizeInbox: '' };
}
export function paperPaths(settings: Settings): { root: string; inbox: string } {
  const current = migrateLayout(settings);
  const root = validateFolder(current.folder);
  const relative = validateFolder(current.inboxName || '未整理');
  return { root, inbox: root + '/' + relative };
}
export function literatureFolders(settings: Settings): string[] {
  const current = migrateLayout(settings);
  return [...new Set([current.folder, ...(current.legacyFolders || [])].filter(Boolean))];
}
