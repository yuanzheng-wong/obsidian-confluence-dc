import { App, Modal, Setting, TAbstractFile, TFolder } from 'obsidian';
import { FileMapping } from '../settings';

type OnSave = (mapping: FileMapping) => void;

export class MappingModal extends Modal {
  private draft: Partial<FileMapping>;

  constructor(
    app: App,
    initial: Partial<FileMapping>,
    private onSave: OnSave
  ) {
    super(app);
    this.draft = { recursive: true, ...initial };
  }

  onOpen(): void {
    const { contentEl } = this;
    const isEdit = Boolean(this.draft.id);
    contentEl.createEl('h2', { text: isEdit ? 'Edit mapping' : 'Add mapping' });

    new Setting(contentEl)
      .setName('Local path')
      .setDesc('Vault-relative path to a file or folder.')
      .addText((text) =>
        text
          .setPlaceholder('knowledge_base/USB')
          .setValue(this.draft.localPath ?? '')
          .onChange((v) => { this.draft.localPath = v.trim(); })
      );

    new Setting(contentEl)
      .setName('Confluence space key')
      .setDesc('e.g. USB, ENG, DOCS')
      .addText((text) =>
        text
          .setPlaceholder('USB')
          .setValue(this.draft.spaceKey ?? '')
          .onChange((v) => { this.draft.spaceKey = v.trim().toUpperCase(); })
      );

    new Setting(contentEl)
      .setName('Parent page ID')
      .setDesc('Numeric Confluence page ID to nest new pages under.')
      .addText((text) =>
        text
          .setPlaceholder('123456')
          .setValue(this.draft.parentPageId ?? '')
          .onChange((v) => { this.draft.parentPageId = v.trim(); })
      );

    new Setting(contentEl)
      .setName('Title override')
      .setDesc('Override page title (leave blank to use the filename).')
      .addText((text) =>
        text
          .setValue(this.draft.titleOverride ?? '')
          .onChange((v) => { this.draft.titleOverride = v.trim() || undefined; })
      );

    new Setting(contentEl)
      .setName('Recursive')
      .setDesc('For folder mappings: also sync files in subfolders.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.draft.recursive ?? true)
          .onChange((v) => { this.draft.recursive = v; })
      );

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText('Save')
        .setCta()
        .onClick(() => {
          if (!this.draft.localPath || !this.draft.spaceKey || !this.draft.parentPageId) {
            return;
          }
          this.onSave({
            id: this.draft.id ?? crypto.randomUUID(),
            localPath: this.draft.localPath,
            spaceKey: this.draft.spaceKey,
            parentPageId: this.draft.parentPageId,
            titleOverride: this.draft.titleOverride,
            recursive: this.draft.recursive ?? true,
            pageId: this.draft.pageId,
          });
          this.close();
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  static forCurrentFile(
    app: App,
    filePath: string,
    onSave: OnSave
  ): MappingModal {
    return new MappingModal(app, { localPath: filePath }, onSave);
  }

  static forCurrentFolder(
    app: App,
    folderPath: string,
    onSave: OnSave
  ): MappingModal {
    return new MappingModal(app, { localPath: folderPath, recursive: true }, onSave);
  }
}
