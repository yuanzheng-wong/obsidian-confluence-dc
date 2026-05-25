# Confluence DC Sync

Push and pull Obsidian notes to **Confluence Data Center** via the REST API. Per-file configuration lives in YAML frontmatter; a sidebar panel handles everything without leaving Obsidian.

---

## Installation

This plugin is not listed in the Obsidian community registry. Install it manually.

### 1. Download

Grab the latest release from the [Releases](../../releases) page and download `main.js`, `manifest.json`, and `styles.css`.

Alternatively, build from source:

```bash
git clone https://github.com/yuanzheng-wong/obsidian-confluence-dc.git
cd obsidian-confluence-dc
npm install
npm run build
# output: dist/main.js
```

### 2. Copy files into your vault

Create the plugin folder inside your vault and copy the three files into it:

```
<vault>/.obsidian/plugins/obsidian-confluence-dc/
├── main.js
├── manifest.json
└── styles.css
```

If building from source, `main.js` is at `dist/main.js`.

### 3. Enable the plugin

1. Open Obsidian → **Settings** → **Community plugins**
2. Turn off **Restricted mode** if prompted
3. Find **Confluence DC Sync** in the installed list and toggle it on

The Confluence sidebar panel will open automatically in the right pane.

---

## Configuration

### Connection

Go to **Settings → Confluence DC Sync** and fill in:

| Field | Description |
| --- | --- |
| Confluence base URL | e.g. `https://confluence.company.com` |
| Authentication type | Username + Password or Personal Access Token |
| Credential source | Store in plugin settings (encrypted) or read from Bitwarden CLI |
| Default space key | Pre-filled when adding config to a new note (e.g. `DOCS`) |

Click **Test connection** to verify before syncing.

#### Credentials are encrypted

Passwords and PATs are encrypted with Electron `safeStorage` (the OS keychain) before being saved to disk. They are never stored in plain text.

#### Bitwarden option

If you use Bitwarden CLI (`bw`), set **Credential source** to Bitwarden and enter the item name. Click **Unlock** and enter your master password once per session.

---

## Per-file setup

Open any Markdown note and click the **Confluence** icon in the left ribbon (or right-click a file). In the **File** tab:

1. Click **Add Confluence config** — this inserts a frontmatter block at the top of the note:

```yaml
---
confluence-space-key: DOCS
confluence-parent-id:
confluence-title:
---
```

2. Fill in **Space key** and **Parent page ID** (the numeric ID of the parent page). The title defaults to the note filename; set **Title override** to use something different.

3. Click **Push** to create the page. The page ID is written back to frontmatter automatically after the first push.

To find a page's numeric ID in Confluence, open the page and check the URL: `.../pages/123456/...`

---

## Frontmatter reference

```yaml
confluence-space-key: DOCS        # required
confluence-parent-id: 123456      # required for new pages
confluence-page-id: 789012        # filled automatically after first push
confluence-title: My Custom Title # optional, defaults to filename
```

---

## Syncing

### Single file

Use the **Push** / **Pull** buttons in the sidebar File tab, or the command palette:

- `Confluence DC Sync: Push current file`
- `Confluence DC Sync: Pull current file`

### Bulk

Switch to the **Vault** tab in the sidebar for:

- **Push all** / **Pull all** — sync every configured file
- **Check status** — compare local and remote hashes and show per-file status (synced / ahead / behind / conflicted)

### Conflict resolution

If both local and remote have changed since the last sync, a dialog lets you choose:

- **Keep local** — overwrite the remote page
- **Keep remote** — overwrite the local note

---

## Unlinking a note

In the sidebar File tab, scroll to the bottom and click **Unlink from Confluence**. This removes the `confluence-*` frontmatter keys and clears the sync history for that file. The Confluence page is not deleted.
