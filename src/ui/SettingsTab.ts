import { App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import type ConfluencePlugin from '../main';
import { ConfluenceClient } from '../api/client';
import { unlockBw, readSession } from '../api/credentials';
import { encryptSecret, decryptSecret } from '../api/safeStorage';
import { MappingModal } from './MappingModal';
import { FileMapping } from '../settings';

export class ConfluenceSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ConfluencePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Confluence DC Sync' });

    // --- Connection ---
    containerEl.createEl('h3', { text: 'Connection' });

    new Setting(containerEl)
      .setName('Confluence base URL')
      .setDesc('e.g. https://confluence.company.com')
      .addText((text) =>
        text
          .setPlaceholder('https://confluence.example.com')
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (v) => {
            this.plugin.settings.baseUrl = v.trim().replace(/\/$/, '');
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Default space key')
      .setDesc('Pre-filled when adding Confluence config to a new note.')
      .addText((text) =>
        text
          .setPlaceholder('e.g. DOCS')
          .setValue(this.plugin.settings.defaultSpaceKey)
          .onChange(async (v) => {
            this.plugin.settings.defaultSpaceKey = v.trim().toUpperCase();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Authentication type')
      .addDropdown((drop) =>
        drop
          .addOption('basic', 'Username + Password')
          .addOption('pat', 'Personal Access Token')
          .setValue(this.plugin.settings.authType)
          .onChange(async (v: 'basic' | 'pat') => {
            this.plugin.settings.authType = v;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName('Credential source')
      .setDesc('Where to read your credentials from.')
      .addDropdown((drop) =>
        drop
          .addOption('settings', 'Store in plugin settings')
          .addOption('bitwarden', 'Bitwarden CLI (bw)')
          .setValue(this.plugin.settings.credentialSource)
          .onChange(async (v: 'settings' | 'bitwarden') => {
            this.plugin.settings.credentialSource = v;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.credentialSource === 'bitwarden') {
      new Setting(containerEl)
        .setName('Bitwarden item name')
        .setDesc(
          this.plugin.settings.authType === 'pat'
            ? 'Item name in Bitwarden. Store your PAT in its Password field.'
            : 'Item name in Bitwarden. Username and Password fields will be used.'
        )
        .addText((text) =>
          text
            .setPlaceholder('Confluence DC')
            .setValue(this.plugin.settings.bitwardenItem)
            .onChange(async (v) => {
              this.plugin.settings.bitwardenItem = v.trim();
              await this.plugin.saveSettings();
            })
        );

      const session = readSession();
      const statusText = session ? '🔓 Session active' : '🔒 Locked — enter master password to unlock';
      new Setting(containerEl)
        .setName('Bitwarden session')
        .setDesc(statusText)
        .addButton((btn) =>
          btn
            .setButtonText(session ? 'Re-unlock' : 'Unlock')
            .setCta()
            .onClick(() => new UnlockModal(this.app, () => this.display()).open())
        );
    } else if (this.plugin.settings.authType === 'basic') {
      new Setting(containerEl)
        .setName('Username')
        .addText((text) =>
          text
            .setValue(this.plugin.settings.username)
            .onChange(async (v) => {
              this.plugin.settings.username = v;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Password')
        .setDesc('Encrypted with the OS keychain via Electron safeStorage.')
        .addText((text) => {
          text.inputEl.type = 'password';
          text
            .setValue(decryptSecret(this.plugin.settings.password))
            .onChange(async (v) => {
              this.plugin.settings.password = encryptSecret(v);
              await this.plugin.saveSettings();
            });
        });
    } else {
      new Setting(containerEl)
        .setName('Personal Access Token')
        .setDesc('Encrypted with the OS keychain via Electron safeStorage.')
        .addText((text) => {
          text.inputEl.type = 'password';
          text.setValue(decryptSecret(this.plugin.settings.pat)).onChange(async (v) => {
            this.plugin.settings.pat = encryptSecret(v);
            await this.plugin.saveSettings();
          });
        });
    }

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText('Test connection').onClick(async () => {
        try {
          await new ConfluenceClient(this.plugin.settings).testConnection();
          new Notice('Connection successful');
        } catch (e) {
          new Notice(`Connection failed: ${(e as Error).message}`);
        }
      })
    );

    // --- Jira ---
    containerEl.createEl('h3', { text: 'Jira Integration' });

    new Setting(containerEl)
      .setName('Jira server name')
      .setDesc('Application link name as configured in Confluence (used in [JIRA:KEY] macros).')
      .addText((text) =>
        text
          .setPlaceholder('quectel-ticket')
          .setValue(this.plugin.settings.jiraServer)
          .onChange(async (v) => {
            this.plugin.settings.jiraServer = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Jira server ID')
      .setDesc('UUID of the Jira application link (found in Confluence Admin → Application Links).')
      .addText((text) =>
        text
          .setPlaceholder('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')
          .setValue(this.plugin.settings.jiraServerId)
          .onChange(async (v) => {
            this.plugin.settings.jiraServerId = v.trim();
            await this.plugin.saveSettings();
          })
      );

    // --- Attachments ---
    containerEl.createEl('h3', { text: 'Attachments' });
    new Setting(containerEl)
      .setName('Attachments folder')
      .setDesc('Vault-relative folder where pulled images are saved. Must already exist.')
      .addText((text) =>
        text
          .setPlaceholder('Attachments')
          .setValue(this.plugin.settings.attachmentsFolder)
          .onChange(async (v) => {
            this.plugin.settings.attachmentsFolder = v.trim() || 'Attachments';
            await this.plugin.saveSettings();
          })
      );

    // --- Mappings ---
    containerEl.createEl('h3', { text: 'Mappings' });
    containerEl.createEl('p', {
      text: 'Map vault files or folders to Confluence spaces.',
      cls: 'setting-item-description',
    });

    for (const mapping of this.plugin.settings.mappings) {
      this.renderMapping(containerEl, mapping);
    }

    new Setting(containerEl).addButton((btn) =>
      btn
        .setButtonText('Add mapping')
        .setCta()
        .onClick(() => {
          new MappingModal(this.app, {}, async (m) => {
            this.plugin.settings.mappings.push(m);
            await this.plugin.saveSettings();
            this.display();
          }).open();
        })
    );
  }

  private renderMapping(containerEl: HTMLElement, mapping: FileMapping): void {
    const desc = [
      `Space: ${mapping.spaceKey}`,
      `Parent: ${mapping.parentPageId}`,
      mapping.recursive ? 'recursive' : 'top-level only',
    ].join(' · ');

    new Setting(containerEl)
      .setName(mapping.localPath)
      .setDesc(desc)
      .addButton((btn) =>
        btn.setButtonText('Edit').onClick(() => {
          new MappingModal(this.app, mapping, async (updated) => {
            const idx = this.plugin.settings.mappings.findIndex(
              (m) => m.id === mapping.id
            );
            if (idx !== -1) this.plugin.settings.mappings[idx] = updated;
            await this.plugin.saveSettings();
            this.display();
          }).open();
        })
      )
      .addButton((btn) =>
        btn
          .setButtonText('Remove')
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.mappings =
              this.plugin.settings.mappings.filter((m) => m.id !== mapping.id);
            await this.plugin.saveSettings();
            this.display();
          })
      );
  }
}

class UnlockModal extends Modal {
  private password = '';

  constructor(app: App, private onUnlocked: () => void) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Unlock Bitwarden' });

    new Setting(contentEl)
      .setName('Master password')
      .addText((text) => {
        text.inputEl.type = 'password';
        text.inputEl.focus();
        text.onChange((v) => { this.password = v; });
        text.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') this.doUnlock();
        });
      });

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText('Unlock').setCta().onClick(() => this.doUnlock())
    );
  }

  private async doUnlock(): Promise<void> {
    try {
      unlockBw(this.password);
      new Notice('Bitwarden unlocked');
      this.close();
      this.onUnlocked();
    } catch (e) {
      new Notice(`Unlock failed: ${(e as Error).message}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
