export interface FileMapping {
  id: string;
  localPath: string;       // vault-relative path, file or folder
  spaceKey: string;
  parentPageId: string;    // parent page for new pages
  pageId?: string;         // filled after first push (single file mappings)
  titleOverride?: string;  // override page title, defaults to filename stem
  recursive: boolean;      // for folders: descend into subfolders
}

export interface ConfluenceSettings {
  baseUrl: string;
  authType: 'basic' | 'pat';
  credentialSource: 'settings' | 'bitwarden';
  bitwardenItem: string;
  username: string;
  password: string;
  pat: string;
  attachmentsFolder: string;
  defaultSpaceKey: string;
  mappings: FileMapping[];
  jiraServer: string;
  jiraServerId: string;
}

export const DEFAULT_SETTINGS: ConfluenceSettings = {
  baseUrl: '',
  authType: 'basic',
  credentialSource: 'settings',
  bitwardenItem: '',
  username: '',
  password: '',
  pat: '',
  attachmentsFolder: 'Attachments',
  defaultSpaceKey: '',
  mappings: [],
  jiraServer: '',
  jiraServerId: '',
};
