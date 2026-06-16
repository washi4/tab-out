# Workspace Tab Selection Design Plan

A customized premium modal popup allowing users to filter and select specific tabs when saving a named workspace.

## 1. Overview
Instead of saving all currently open tabs by default using a raw browser `prompt()`, the "Save Workspace" button now opens a beautiful, customizable in-page modal. This modal presents a text input for the workspace name and a checklist of all open tabs grouped by domain. Users can toggle tabs on/off, bulk-toggle all tabs, and save a tailored workspace slot.

## 2. UI Components & Elements
We will inject a new modal block into `index.html`:
- **Modal Backdrop (`#workspace-modal-backdrop`)**: A full-screen overlay with a subtle dark backdrop blur.
- **Modal Container (`#workspace-modal`)**: A centered dialog box following the retro cyberpunk styled palette.
- **Input (`#workspace-name-input`)**: A focused neon-border text field for the workspace name.
- **Bulk Toggles**: "Select All" and "Deselect All" text-link quick controllers.
- **Checked Tab List (`#workspace-modal-tab-list`)**: A scrollable box listing grouped tabs with circular checkboxes.
- **Buttons**:
  - Cancel (`#workspace-modal-cancel`)
  - Save (`#workspace-modal-save`)

## 3. Data Flow & Mechanics
- Clicking `#save-session-btn` (re-labeled/used for Workspace saving) initiates the modal.
- It queries active tabs (`chrome.tabs.query`) and groups them by domain to match the dashboard's design.
- Each checkbox binds to the individual tab ID.
- Clicking "Save" validates the workspace name (using standard security sanitization and avoiding blank names).
- Saves only the checked tab entries `{ title, url, favIconUrl }` to `chrome.storage.local`.
- Re-renders workspaces instantly in the sidebar and plays a synthesized chime.
