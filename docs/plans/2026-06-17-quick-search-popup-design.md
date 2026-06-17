# Tab Out Quick Search Popup — Design Plan

## 1. Introduction
The Tab Out Quick Search Popup provides a fast, lightweight, keyboard-friendly way to list and search open tabs from any webpage, without needing to open a new tab. It is launched via the default keyboard shortcut `Alt+Shift+T` or by clicking the extension icon.

---

## 2. Architecture & Components

### 2.1 Manifest Configuration (`manifest.json`)
* Configure the default action popup:
  ```json
  "action": {
    "default_popup": "popup.html",
    ...
  }
  ```
* Configure the global command keybinding:
  ```json
  "commands": {
    "_execute_action": {
      "suggested_key": {
        "default": "Alt+Shift+T",
        "mac": "MacCtrl+Shift+T"
      },
      "description": "Show open tabs list instantly"
    }
  }
  ```

### 2.2 Files to Create
* `extension/popup.html`: The HTML structure of the popup.
* `extension/popup.css`: Lightweight stylesheet custom-built for popup-specific layout and theme synchronization.
* `extension/popup.js`: Script containing tab querying, domain grouping, search filtering, list rendering, and keyboard event handling.

---

## 3. UI & Interaction Flow

### 3.1 States
1. **Empty Query (Default State)**: Groups all open tabs by domain, sorted in descending order of tab count per domain.
2. **Search Filtering State**: Flattens tabs into a single scrollable list of fuzzy match results, sorted by title match relevance first, then URL match.

### 3.2 Micro-interactions & Style
* Auto-focus `#search-input` on open.
* Beautiful adaptive light ("Sage Paper") and dark ("Cyber Deck") themes using colors read from `chrome.storage.local`.
* Interactive keyboard selection highlighting with retro/glowing aura borders (`.selected`).
* Compact layout: maximum width `420px`, maximum height `560px`.

### 3.3 Keyboard Actions
* `ArrowDown` / `Tab`: Navigate focus down the list.
* `ArrowUp` / `Shift+Tab`: Navigate focus up the list.
* `Enter`: Switch to the selected tab and close the popup immediately via `window.close()`.
* `Escape`: Closes the popup.

---

## 4. Implementation Steps
1. Add action popup and command in `manifest.json`.
2. Write popup HTML container.
3. Apply lightweight stylesheets to support both theme configurations.
4. Implement tabs loading, grouping, fuzzy query filtering, and keyboard control logic in `popup.js`.
5. Verify behavior locally.
