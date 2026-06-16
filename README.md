# Tab Out

**Keep tabs on your tabs.**

Tab Out is a Chromium extension that replaces your new tab page with a dashboard of everything you have open. Tabs are grouped by domain, with homepages (Gmail, X, LinkedIn, etc.) pulled into their own group. Close tabs with a satisfying swoosh + confetti.

No server. No account. No external API calls. Just a browser extension that works in Chrome and Edge.

![Tab Out Screenshot](./tapout.png)

Originally based on the open-source Tab Out project by Zara Zhang and adapted here as a personal customized build under the MIT License.

---

## Install with a coding agent

Send your coding agent (Claude Code, Codex, etc.) this repo and say **"install this"**:

```
https://github.com/washi4/tab-out
```

The agent will walk you through it. Takes about 1 minute.

---

## Features

- **Tab Sleep & RAM Saver (极客标签页“内存拯救者”)** — Displays sleeping tabs with a cozy breathing `💤` badge. Adds a click-to-freeze snowflake `❄️` button on active chips and a "Freeze all tabs" button on group cards to discard tabs and free up hundreds of MBs of memory instantly. Accompanied by a cold, crystalline freeze synthesizer sweep.
- **Workspace Session Manager (多命名工作区管理)** — Save selected open tabs into separate named workspaces (e.g. "AI Coding", "Travel Planning") using an elegant, grouped checkbox checklist popup modal. Swap or restore them easily from the Saved Workspaces sidebar pane, fully equipped with individual delete controls and tactile slide-in transitions.
- **Premium Theme Switcher (双色主题极速切换)** — Toggle seamlessly between a warm, earthy "Sage Paper" light aesthetic and a glowing, sci-fi dark "Cyber Deck" mode. Complete with customized, theme-specific Web Audio synthesizer feedback and color-shifting confetti bursts!
- **Vim-style Keyboard Maestro (全键盘极速微操)** — Navigate, open, freeze, and close tabs entirely from your keyboard without using a mouse. Focus/select tabs with `Tab`/`Shift-Tab`, Vim-keys (`j`/`k`), or Arrow keys (`ArrowUp`/`ArrowDown`). Press `Enter` to jump, `d` to close, `s` to save, and `f` to freeze, fully synced with the holographic target pointer.
- **See all your tabs at a glance** on a clean grid, grouped by domain
- **Homepages group** pulls Gmail inbox, X home, YouTube, LinkedIn, GitHub homepages into one card
- **Satisfying Sound Synthesis & Confetti** plays swoosh/save/combo sounds synthesized directly via Web Audio API + premium confetti burst physics
- **Combo Streak Multipliers** keeps you motivated to close clutter with responsive HUD combo streak multipliers that reward fast cleanup
- **Cyberpunk HUD Holographic Cursor** sleek laser targets, interactive spring physics, and cursor ring shrink animations on hover and clicks
- **Interactive Autocomplete Command Palette** press `/` or focus the top-right search box to expand it to `600px` and reveal a fully keyboard-navigable (`ArrowUp`/`ArrowDown`/`Enter`) autocomplete suggestion dropdown that lets you switch tabs instantly
- **Reboot Protection Session Snapshot** one-click silent session backup that saves a non-destructive snapshot in Chrome local storage, showing a `Restore Session (N)` button to bring back all tabs instantly without stacking duplicates
- **Duplicate detection** flags when you have the same page open twice, with one-click cleanup that dynamically updates all counts in real-time
- **Click any tab to jump to it** across windows, no new tab opened
- **Save for later** bookmark tabs to an active checklist before closing them
- **Completed Archive Management** Collapsible history list supporting hover-to-reveal permanent delete buttons and a cascading domino slide-out **"Clear All"** button
- **Localhost grouping** shows port numbers next to each tab so you can tell your vibe coding projects apart
- **Expandable groups** show the first 8 tabs with a clickable "+N more"
- **High-Fidelity Native Favicons** extracts direct tab favicon URLs from Chrome with third-party Google services as a backup, working seamlessly on intranet and localhost projects
- **100% local** your data never leaves your machine
- **Pure browser extension** no server, no Node.js, no npm, no setup beyond loading the extension

---

## Manual Setup

**1. Clone the repo**

```bash
git clone https://github.com/washi4/tab-out.git
```

**2. Load the extension in Chrome or Edge**

1. Open Chrome and go to `chrome://extensions` or open Edge and go to `edge://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Navigate to the `extension/` folder inside the cloned repo and select it

**3. Open a new tab**

You'll see Tab Out.

---

## How it works

```
You open a new tab
  -> Tab Out shows your open tabs grouped by domain
  -> Homepages (Gmail, X, etc.) get their own group at the top
  -> Click any tab title to jump to it
  -> Close groups you're done with (swoosh + confetti)
  -> Save tabs for later before closing them
```

Everything runs inside the extension. No external server, no API calls, no data sent anywhere. Saved tabs are stored in `chrome.storage.local`.

---

## Tech stack

| What | How |
|------|-----|
| Extension | Chrome Manifest V3 |
| Storage | chrome.storage.local |
| Sound | Web Audio API (synthesized, no files) |
| Animations | CSS transitions + JS confetti particles |

---

## License

MIT
