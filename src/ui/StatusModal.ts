import { App, Modal, Notice, Setting } from 'obsidian';
import { ConfluenceClient } from '../api/client';
import { FileMapping, ConfluenceSettings } from '../settings';
import { StateManager } from '../sync/state';
import { StatusEntry, computeStatus } from '../sync/status';
import { pushFile } from '../sync/push';
import { pullFile } from '../sync/pull';
import { ConflictModal } from './ConflictModal';
import { ConflictError } from '../sync/push';

const STATUS_LABELS: Record<string, string> = {
  synced: '✓ synced',
  ahead: '↑ ahead',
  behind: '↓ behind',
  conflicted: '! conflicted',
  new: '? untracked',
  'remote-only': '↓ remote only',
};

export class StatusModal extends Modal {
  constructor(
    app: App,
    private mappings: FileMapping[],
    private client: ConfluenceClient,
    private stateManager: StateManager,
    private settings: ConfluenceSettings
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Confluence sync status' });

    const loading = contentEl.createEl('p', { text: 'Computing status…' });

    let entries: StatusEntry[];
    try {
      entries = await computeStatus(
        this.mappings,
        this.app.vault,
        this.client,
        this.stateManager
      );
    } catch (e) {
      loading.setText(`Error: ${(e as Error).message}`);
      return;
    }
    loading.remove();

    if (entries.length === 0) {
      contentEl.createEl('p', { text: 'No mapped files found.' });
      return;
    }

    const groups: Record<string, StatusEntry[]> = {
      conflicted: [],
      ahead: [],
      behind: [],
      new: [],
      'remote-only': [],
      synced: [],
    };
    for (const e of entries) {
      (groups[e.status] ?? groups.synced).push(e);
    }

    for (const [status, group] of Object.entries(groups)) {
      if (group.length === 0) continue;
      contentEl.createEl('h3', { text: STATUS_LABELS[status] ?? status });

      for (const entry of group) {
        const setting = new Setting(contentEl).setName(entry.filePath);

        if (entry.record?.pageUrl) {
          setting.setDesc(entry.record.pageUrl);
        }

        if (status === 'ahead' || status === 'new') {
          setting.addButton((btn) =>
            btn
              .setButtonText('Push')
              .setCta()
              .onClick(() => this.doPush(entry))
          );
        }

        if (status === 'behind') {
          setting.addButton((btn) =>
            btn.setButtonText('Pull').onClick(() => this.doPull(entry))
          );
        }

        if (status === 'conflicted') {
          setting
            .addButton((btn) =>
              btn
                .setButtonText('Push (overwrite remote)')
                .onClick(() => this.doPush(entry, 'local'))
            )
            .addButton((btn) =>
              btn
                .setButtonText('Pull (overwrite local)')
                .onClick(() => this.doPull(entry, 'remote'))
            );
        }
      }
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText('Push all ahead')
          .onClick(() => this.pushAll(groups.ahead))
      )
      .addButton((btn) =>
        btn
          .setButtonText('Pull all behind')
          .onClick(() => this.pullAll(groups.behind))
      );
  }

  private findMapping(filePath: string): FileMapping | undefined {
    return this.mappings.find(
      (m) =>
        filePath === m.localPath || filePath.startsWith(m.localPath + '/')
    );
  }

  private async doPush(
    entry: StatusEntry,
    force: 'local' | 'none' = 'none'
  ): Promise<void> {
    const mapping = this.findMapping(entry.filePath);
    if (!mapping) return;
    try {
      await pushFile(
        entry.filePath,
        mapping,
        this.app.vault,
        this.client,
        this.stateManager,
        force
      );
      new Notice(`Pushed: ${entry.filePath}`);
      this.close();
      this.open();
    } catch (e) {
      if (e instanceof ConflictError) {
        const resolution = await new ConflictModal(
          this.app,
          e.filePath,
          e.record,
          e.remotePage
        ).prompt();
        if (resolution === 'local') await this.doPush(entry, 'local');
      } else {
        new Notice(`Push failed: ${(e as Error).message}`);
      }
    }
  }

  private async doPull(
    entry: StatusEntry,
    force: 'remote' | 'none' = 'none'
  ): Promise<void> {
    const mapping = this.findMapping(entry.filePath);
    if (!mapping) return;
    try {
      await pullFile(
        entry.filePath,
        mapping,
        this.app.vault,
        this.client,
        this.stateManager,
        this.settings,
        force
      );
      new Notice(`Pulled: ${entry.filePath}`);
      this.close();
      this.open();
    } catch (e) {
      new Notice(`Pull failed: ${(e as Error).message}`);
    }
  }

  private async pushAll(entries: StatusEntry[]): Promise<void> {
    for (const e of entries) await this.doPush(e);
  }

  private async pullAll(entries: StatusEntry[]): Promise<void> {
    for (const e of entries) await this.doPull(e);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
