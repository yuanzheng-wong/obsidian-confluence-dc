import { FileSystemAdapter, Notice, Plugin, TFile, TFolder } from 'obsidian';
import { join } from 'path';
import { ConfluenceSettings, DEFAULT_SETTINGS } from './settings';
import { ConfluenceClient } from './api/client';
import { initCredentials } from './api/credentials';
import { StateManager } from './sync/state';
import { pushFile, ConflictError } from './sync/push';
import { pullFile } from './sync/pull';
import { resolveFiles } from './sync/status';
import {
  readConfluenceFrontmatter,
  writeConfluenceFrontmatter,
  frontmatterToMapping,
} from './sync/frontmatter';
import { ConfluenceSettingTab } from './ui/SettingsTab';
import { StatusModal } from './ui/StatusModal';
import { MappingModal } from './ui/MappingModal';
import { ConflictModal } from './ui/ConflictModal';
import { ProgressNotice, yieldToUI } from './ui/ProgressNotice';
import { ConfluenceSidebarView, VIEW_TYPE_CONFLUENCE } from './ui/SidebarView';

export default class ConfluencePlugin extends Plugin {
  settings!: ConfluenceSettings;
  stateManager!: StateManager;

  async onload(): Promise<void> {
    const basePath = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
    initCredentials(join(basePath, this.manifest.dir));

    await this.loadSettings();
    this.stateManager = new StateManager(this);
    await this.stateManager.load();

    this.addSettingTab(new ConfluenceSettingTab(this.app, this));

    this.registerView(
      VIEW_TYPE_CONFLUENCE,
      (leaf) => new ConfluenceSidebarView(leaf, this)
    );

    this.addRibbonIcon('cloud', 'Confluence', () => {
      this.activateSidebarView();
    });

    this.app.workspace.onLayoutReady(() => {
      this.activateSidebarView();
    });

    this.addCommand({
      id: 'push-current-file',
      name: 'Push current file',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.pushFile(file.path);
        return true;
      },
    });

    this.addCommand({
      id: 'pull-current-file',
      name: 'Pull current file',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.pullFile(file.path);
        return true;
      },
    });

    this.addCommand({
      id: 'push-all',
      name: 'Push all mapped files',
      callback: () => this.pushAll(),
    });

    this.addCommand({
      id: 'pull-all',
      name: 'Pull all mapped files',
      callback: () => this.pullAll(),
    });

    this.addCommand({
      id: 'sync-status',
      name: 'Show sync status',
      callback: () => this.openStatusModal(),
    });

    this.addCommand({
      id: 'map-current-file',
      name: 'Map current file to Confluence',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.addMapping(file.path);
        return true;
      },
    });

    this.addCommand({
      id: 'map-current-folder',
      name: 'Map current folder to Confluence',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        const folder = file.parent?.path;
        if (!folder) return false;
        if (!checking) this.addMapping(folder);
        return true;
      },
    });

    this.addCommand({
      id: 'import-frontmatter-from-state',
      name: 'Import Confluence config from sync state',
      callback: () => this.importFrontmatterFromState(),
    });

    // Track renames so sync state stays accurate
    this.registerEvent(
      this.app.vault.on('rename', (abstract, oldPath) => {
        this.stateManager.rename(oldPath, abstract.path);
      })
    );
  }

  client(): ConfluenceClient {
    return new ConfluenceClient(this.settings);
  }

  private findMapping(filePath: string) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      const fm = readConfluenceFrontmatter(this.app, file);
      const fmMapping = frontmatterToMapping(fm, filePath);
      if (fmMapping) return fmMapping;
    }
    return this.settings.mappings.find(
      (m) =>
        filePath === m.localPath || filePath.startsWith(m.localPath + '/')
    );
  }

  async pushFile(filePath: string): Promise<void> {
    const mapping = this.findMapping(filePath);
    if (!mapping) {
      new Notice(`No mapping for ${filePath}. Use "Map current file" first.`);
      throw new Error('No mapping');
    }
    const progress = new ProgressNotice('Pushing…');
    await yieldToUI(); // let the notice paint before any work starts
    const onProgress = async (msg: string) => { progress.update(msg); await yieldToUI(); };
    try {
      const page = await pushFile(
        filePath,
        mapping,
        this.app.vault,
        this.client(),
        this.stateManager,
        'none',
        onProgress
      );
      progress.finish(`Pushed → ${page.title}`);
      await this.writeFrontmatterPageId(filePath, page.id);
    } catch (e) {
      progress.fail(`Push failed: ${(e as Error).message}`);
      if (e instanceof ConflictError) {
        const resolution = await new ConflictModal(
          this.app,
          e.filePath,
          e.record,
          e.remotePage
        ).prompt();
        if (resolution === 'local') {
          const p2 = new ProgressNotice('Pushing (local wins)…');
          const onP2 = async (msg: string) => { p2.update(msg); await yieldToUI(); };
          await pushFile(
            filePath,
            mapping,
            this.app.vault,
            this.client(),
            this.stateManager,
            'local',
            onP2
          );
          p2.finish(`Pushed (local wins): ${filePath}`);
        } else if (resolution === 'remote') {
          await pullFile(
            filePath,
            mapping,
            this.app.vault,
            this.client(),
            this.stateManager,
            this.settings,
            'remote'
          );
          new Notice(`Pulled (remote wins): ${filePath}`);
        }
      } else {
        console.error('[confluence-dc] push failed', e);
        throw e;
      }
    }
  }

  async pullFile(filePath: string): Promise<void> {
    const mapping = this.findMapping(filePath);
    if (!mapping) {
      new Notice(`No mapping for ${filePath}. Use "Map current file" first.`);
      throw new Error('No mapping');
    }
    try {
      await pullFile(
        filePath,
        mapping,
        this.app.vault,
        this.client(),
        this.stateManager,
        this.settings
      );
      new Notice(`Pulled: ${filePath}`);
    } catch (e) {
      if (e instanceof ConflictError) {
        const resolution = await new ConflictModal(
          this.app,
          e.filePath,
          e.record,
          e.remotePage
        ).prompt();
        if (resolution === 'remote') {
          await pullFile(
            filePath,
            mapping,
            this.app.vault,
            this.client(),
            this.stateManager,
            this.settings,
            'remote'
          );
          new Notice(`Pulled (remote wins): ${filePath}`);
        } else if (resolution === 'local') {
          await pushFile(
            filePath,
            mapping,
            this.app.vault,
            this.client(),
            this.stateManager,
            'local'
          );
          new Notice(`Pushed (local wins): ${filePath}`);
        }
      } else {
        new Notice(`Pull failed: ${(e as Error).message}`);
        throw e;
      }
    }
  }

  async pushAll(): Promise<void> {
    let pushed = 0;
    let failed = 0;
    for (const mapping of this.settings.mappings) {
      const files = await resolveFiles(mapping, this.app.vault);
      for (const filePath of files) {
        try {
          await pushFile(
            filePath,
            mapping,
            this.app.vault,
            this.client(),
            this.stateManager
          );
          pushed++;
        } catch {
          failed++;
        }
      }
    }
    new Notice(`Push all: ${pushed} pushed, ${failed} failed/conflicted`);
  }

  async pullAll(): Promise<void> {
    let pulled = 0;
    let failed = 0;
    for (const mapping of this.settings.mappings) {
      const files = await resolveFiles(mapping, this.app.vault);
      for (const filePath of files) {
        if (!this.stateManager.get(filePath)) continue;
        try {
          await pullFile(
            filePath,
            mapping,
            this.app.vault,
            this.client(),
            this.stateManager,
            this.settings
          );
          pulled++;
        } catch {
          failed++;
        }
      }
    }
    new Notice(`Pull all: ${pulled} pulled, ${failed} failed/conflicted`);
  }

  async activateSidebarView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CONFLUENCE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_CONFLUENCE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  private async writeFrontmatterPageId(filePath: string, pageId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;
    const fm = readConfluenceFrontmatter(this.app, file);
    if (fm.spaceKey && fm.pageId !== pageId) {
      await writeConfluenceFrontmatter(this.app, file, { pageId });
    }
  }

  async importFrontmatterFromState(): Promise<void> {
    const records = this.stateManager.all();
    let imported = 0;
    for (const [filePath, record] of Object.entries(records)) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) continue;
      const fm = readConfluenceFrontmatter(this.app, file);
      if (fm.spaceKey) continue; // already configured
      await writeConfluenceFrontmatter(this.app, file, {
        spaceKey: record.spaceKey,
        pageId: record.pageId,
      });
      imported++;
    }
    new Notice(imported > 0 ? `Imported config for ${imported} file(s)` : 'No new files to import');
  }

  private openStatusModal(): void {
    new StatusModal(
      this.app,
      this.settings.mappings,
      this.client(),
      this.stateManager,
      this.settings
    ).open();
  }

  private addMapping(localPath: string): void {
    new MappingModal(this.app, { localPath }, async (mapping) => {
      this.settings.mappings.push(mapping);
      await this.saveSettings();
      new Notice(`Mapped: ${localPath}`);
    }).open();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
