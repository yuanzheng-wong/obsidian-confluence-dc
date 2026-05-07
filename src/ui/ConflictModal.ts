import { App, Modal, Setting } from 'obsidian';
import { ConfluencePage } from '../api/types';
import { FileSyncRecord } from '../sync/state';

export type ConflictResolution = 'local' | 'remote' | 'cancel';

export class ConflictModal extends Modal {
  private resolution: ConflictResolution = 'cancel';
  private resolve!: (r: ConflictResolution) => void;

  constructor(
    app: App,
    private filePath: string,
    private record: FileSyncRecord,
    private remotePage: ConfluencePage
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Sync conflict' });
    contentEl.createEl('p', {
      text: `Both the local file and the Confluence page have changed since the last sync.`,
    });

    const info = contentEl.createEl('div', { cls: 'confluence-conflict-info' });
    info.createEl('p', { text: `File: ${this.filePath}` });
    info.createEl('p', {
      text: `Last synced: ${new Date(this.record.lastSynced).toLocaleString()}`,
    });
    info.createEl('p', {
      text: `Remote page: ${this.remotePage.title} (v${this.remotePage.version.number})`,
    });

    new Setting(contentEl)
      .setName('Keep local')
      .setDesc('Overwrite the Confluence page with your local content.')
      .addButton((btn) =>
        btn
          .setButtonText('Use local')
          .setCta()
          .onClick(() => {
            this.resolution = 'local';
            this.close();
          })
      );

    new Setting(contentEl)
      .setName('Keep remote')
      .setDesc('Overwrite your local file with the Confluence page content.')
      .addButton((btn) =>
        btn.setButtonText('Use remote').onClick(() => {
          this.resolution = 'remote';
          this.close();
        })
      );

    new Setting(contentEl)
      .setName('Cancel')
      .setDesc('Do nothing — resolve the conflict manually.')
      .addButton((btn) =>
        btn.setButtonText('Cancel').onClick(() => {
          this.resolution = 'cancel';
          this.close();
        })
      );
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolve(this.resolution);
  }

  prompt(): Promise<ConflictResolution> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }
}
