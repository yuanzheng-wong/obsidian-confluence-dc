import { ItemView, TFile, WorkspaceLeaf } from 'obsidian';
import type ConfluencePlugin from '../main';
import {
  readConfluenceFrontmatter,
  writeConfluenceFrontmatter,
  scaffoldConfluenceFrontmatter,
  frontmatterToMapping,
} from '../sync/frontmatter';
import { FileMapping } from '../settings';
import { StatusEntry, computeStatus } from '../sync/status';

export const VIEW_TYPE_CONFLUENCE = 'confluence-sidebar';

const STATUS_ICON: Record<string, string> = {
  synced:      '✓',
  ahead:       '↑',
  behind:      '↓',
  conflicted:  '!',
  new:         '·',
  'remote-only': '↓',
};

const STATUS_CLS: Record<string, string> = {
  synced:      'cf-status-synced',
  ahead:       'cf-status-ahead',
  behind:      'cf-status-behind',
  conflicted:  'cf-status-conflict',
  new:         'cf-status-new',
  'remote-only': 'cf-status-behind',
};

type Tab = 'file' | 'vault';

export class ConfluenceSidebarView extends ItemView {
  private activeFilePath: string | null = null;
  private tab: Tab = 'file';
  private vaultStatus: StatusEntry[] | null = null;
  private checkingStatus = false;

  constructor(leaf: WorkspaceLeaf, private plugin: ConfluencePlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_CONFLUENCE; }
  getDisplayText(): string { return 'Confluence'; }
  getIcon(): string { return 'cloud'; }

  async onOpen(): Promise<void> {
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => this.refresh())
    );
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (file.path === this.activeFilePath) this.refresh();
      })
    );
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  async refresh(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();

    const file = this.app.workspace.getActiveFile();
    this.activeFilePath = file?.path ?? null;

    this.renderTabBar(contentEl);

    if (this.tab === 'file') {
      this.renderFileTab(contentEl, file);
    } else {
      this.renderVaultTab(contentEl);
    }
  }

  // --- Tab bar ---

  private renderTabBar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: 'cf-tab-bar' });
    for (const t of ['file', 'vault'] as Tab[]) {
      const btn = bar.createEl('button', {
        text: t === 'file' ? 'File' : 'Vault',
        cls: 'cf-tab' + (this.tab === t ? ' cf-tab-active' : ''),
      });
      btn.addEventListener('click', () => {
        if (this.tab !== t) { this.tab = t; this.refresh(); }
      });
    }
  }

  // --- File tab ---

  private renderFileTab(root: HTMLElement, file: TFile | null): void {
    if (!file || file.extension !== 'md') {
      root.createEl('p', {
        text: 'Open a Markdown note to configure Confluence sync.',
        cls: 'cf-empty',
      });
      this.addActionButton(root, 'Import config from sync state', '', async () => {
        await this.plugin.importFrontmatterFromState();
      });
      return;
    }

    const fm = readConfluenceFrontmatter(this.app, file);
    const record = this.plugin.stateManager.get(file.path);

    root.createEl('div', { cls: 'cf-filename', text: file.basename });

    const cache = this.app.metadataCache.getFileCache(file);
    const rawFm = cache?.frontmatter ?? {};
    const hasConfig = 'confluence-space-key' in rawFm || 'confluence-parent-id' in rawFm;

    if (!hasConfig) {
      this.addActionButton(root, 'Add Confluence config', 'mod-cta', async () => {
        await scaffoldConfluenceFrontmatter(this.app, file);
        // metadataCache 'changed' event will trigger refresh once the write lands
      });
      return;
    }

    // Config fields
    const form = root.createDiv({ cls: 'cf-form' });

    this.addField(form, 'Space key', fm.spaceKey ?? '', 'e.g. DOCS', async (v) => {
      await writeConfluenceFrontmatter(this.app, file, { spaceKey: v || undefined });
    });

    this.addField(form, 'Parent page ID', fm.parentId ?? '', 'e.g. 123456', async (v) => {
      await writeConfluenceFrontmatter(this.app, file, { parentId: v || undefined });
    });

    this.addField(form, 'Title override', fm.titleOverride ?? '', `default: ${file.basename}`, async (v) => {
      await writeConfluenceFrontmatter(this.app, file, { titleOverride: v || undefined });
    });

    if (fm.pageId ?? record?.pageId) {
      const pageId = fm.pageId ?? record!.pageId;
      const row = form.createDiv({ cls: 'cf-field-row' });
      row.createEl('span', { cls: 'cf-label', text: 'Page ID' });
      if (record?.pageUrl) {
        row.createEl('a', { cls: 'cf-value-link', text: pageId, href: record.pageUrl });
      } else {
        row.createEl('span', { cls: 'cf-value-muted', text: pageId });
      }
    }

    // Status
    const statusEl = root.createDiv({ cls: 'cf-status' });
    if (!fm.spaceKey && !record) {
      statusEl.setText('Not configured');
    } else if (!record) {
      statusEl.setText('Not yet synced');
    } else {
      const d = new Date(record.lastSynced);
      statusEl.setText(`Synced ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`);
    }

    // Actions
    const canSync = !!(fm.spaceKey && (fm.parentId || fm.pageId || record?.pageId));
    if (canSync) {
      const actions = root.createDiv({ cls: 'cf-actions' });
      this.addActionButton(actions, 'Push', 'mod-cta', () => this.plugin.pushFile(file.path));
      this.addActionButton(actions, 'Pull', '', () => this.plugin.pullFile(file.path));
    }
  }

  // --- Vault tab ---

  private renderVaultTab(root: HTMLElement): void {
    const entries = this.gatherTrackedFiles();

    // Bulk actions
    const bulk = root.createDiv({ cls: 'cf-actions cf-bulk' });
    this.addActionButton(bulk, 'Push all', 'mod-cta', () => this.plugin.pushAll());
    this.addActionButton(bulk, 'Pull all', '', () => this.plugin.pullAll());

    // Check status button
    const checkRow = root.createDiv({ cls: 'cf-check-row' });
    const checkBtn = checkRow.createEl('button', {
      text: this.checkingStatus ? 'Checking…' : 'Check status',
      cls: 'cf-check-btn',
    });
    checkBtn.disabled = this.checkingStatus;
    checkBtn.addEventListener('click', async () => {
      this.checkingStatus = true;
      this.vaultStatus = null;
      await this.refresh();
      try {
        const mappings = this.buildMappingsForStatus(entries);
        this.vaultStatus = await computeStatus(
          mappings,
          this.app.vault,
          this.plugin.client(),
          this.plugin.stateManager
        );
      } finally {
        this.checkingStatus = false;
        await this.refresh();
      }
    });

    if (entries.length === 0) {
      root.createEl('p', { text: 'No tracked files yet.', cls: 'cf-empty' });
      return;
    }

    // File list
    const list = root.createDiv({ cls: 'cf-file-list' });
    for (const entry of entries) {
      this.renderVaultEntry(list, entry);
    }
  }

  private renderVaultEntry(
    list: HTMLElement,
    entry: { filePath: string; spaceKey?: string; lastSynced?: string }
  ): void {
    const statusEntry = this.vaultStatus?.find((s) => s.filePath === entry.filePath);
    const status = statusEntry?.status;

    const row = list.createDiv({ cls: 'cf-vault-row' });

    const icon = row.createEl('span', {
      cls: 'cf-vault-icon ' + (status ? (STATUS_CLS[status] ?? '') : 'cf-status-unknown'),
      text: status ? (STATUS_ICON[status] ?? '·') : '·',
    });
    icon.title = status ?? 'unknown';

    const info = row.createDiv({ cls: 'cf-vault-info' });
    const name = info.createEl('span', {
      cls: 'cf-vault-name',
      text: entry.filePath.split('/').pop()?.replace(/\.md$/, '') ?? entry.filePath,
    });
    name.title = entry.filePath;
    name.addEventListener('click', () => {
      const file = this.app.vault.getAbstractFileByPath(entry.filePath);
      if (file instanceof TFile) {
        this.app.workspace.getLeaf(false).openFile(file);
        this.tab = 'file';
        this.refresh();
      }
    });

    const meta: string[] = [];
    if (entry.spaceKey) meta.push(entry.spaceKey);
    if (entry.lastSynced) {
      const d = new Date(entry.lastSynced);
      meta.push(this.relativeTime(d));
    } else {
      meta.push('never synced');
    }
    info.createEl('span', { cls: 'cf-vault-meta', text: meta.join(' · ') });
  }

  // --- Helpers ---

  private gatherTrackedFiles(): { filePath: string; spaceKey?: string; lastSynced?: string }[] {
    const map = new Map<string, { filePath: string; spaceKey?: string; lastSynced?: string }>();

    for (const [filePath, record] of Object.entries(this.plugin.stateManager.all())) {
      map.set(filePath, { filePath, spaceKey: record.spaceKey, lastSynced: record.lastSynced });
    }

    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = readConfluenceFrontmatter(this.app, file);
      if (fm.spaceKey && !map.has(file.path)) {
        map.set(file.path, { filePath: file.path, spaceKey: fm.spaceKey });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  private buildMappingsForStatus(
    entries: { filePath: string; spaceKey?: string }[]
  ): FileMapping[] {
    return entries.flatMap((entry) => {
      const file = this.app.vault.getAbstractFileByPath(entry.filePath);
      if (!(file instanceof TFile)) return [];
      const fm = readConfluenceFrontmatter(this.app, file);
      const mapping = frontmatterToMapping(fm, entry.filePath);
      if (mapping) return [mapping];
      // Fallback: build from state record if frontmatter mapping isn't available
      const record = this.plugin.stateManager.get(entry.filePath);
      if (record && entry.spaceKey) {
        return [{
          id: `state:${entry.filePath}`,
          localPath: entry.filePath,
          spaceKey: entry.spaceKey,
          parentPageId: '',
          pageId: record.pageId,
          recursive: false,
        }];
      }
      return [];
    });
  }

  private relativeTime(d: Date): string {
    const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  private addActionButton(
    container: HTMLElement,
    label: string,
    cls: string,
    action: () => Promise<void>
  ): void {
    const btn = container.createEl('button', { text: label, cls: cls || undefined });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.setText(`${label}…`);
      btn.addClass('cf-btn-loading');
      try {
        await action();
        btn.setText('✓ Done');
        btn.addClass('cf-btn-done');
        setTimeout(() => {
          btn.removeClass('cf-btn-done');
          this.refresh();
        }, 1500);
      } catch {
        btn.setText('✗ Failed');
        btn.addClass('cf-btn-error');
        setTimeout(() => {
          btn.disabled = false;
          btn.setText(label);
          btn.removeClass('cf-btn-loading', 'cf-btn-error');
        }, 2000);
      }
    });
  }

  private addField(
    container: HTMLElement,
    label: string,
    value: string,
    placeholder: string,
    onChange: (v: string) => Promise<void>
  ): void {
    const row = container.createDiv({ cls: 'cf-field-row' });
    row.createEl('label', { cls: 'cf-label', text: label });
    const input = row.createEl('input', {
      cls: 'cf-input',
      type: 'text',
      placeholder,
    }) as HTMLInputElement;
    input.value = value;
    input.addEventListener('change', () => onChange(input.value.trim()));
  }
}
