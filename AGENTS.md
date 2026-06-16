# AGENTS.md -- Tab Out: Setup & Onboarding Guide for Coding Agents

You're installing **Tab Out** for the user. Your job is not just to set it up -- it's to get them excited about using it.

---

## Step 0 -- Introduce the product

Before doing anything technical, tell the user what they're about to get:

> **Tab Out** replaces your new tab page with a clean dashboard of everything you have open, grouped by domain.
>
> Here's what makes it great:
> - **See all your open tabs at a glance** grouped by domain on a clean, responsive grid layout.
> - **Tab Sleep & RAM Saver (极客内存节省)** cold, crystalline audio chime sweeps paired with breathing sleep `💤` badges, click-to-freeze snowflakes `❄️`, and group-wide card freeze tools (`chrome.tabs.discard`).
> - **Workspace Session Manager (多命名工作区)** save selected current tabs into distinct, named custom workspaces using an elegant checkbox checklist popup modal, easily launched or purged via dynamic sidebar interactive controls.
> - **Premium Theme Switcher (双色主题极速切换)** toggle seamlessly between a warm, earthy "Sage Paper" light aesthetic and a glowing, sci-fi dark "Cyber Deck" mode, featuring customized Web Audio synthesizer audio effects and color-shifting confetti particles!
> - **Vim-style Keyboard Maestro (全键盘极速微操)** mouse-free navigation via `Tab`/`Shift-Tab`, Vim `j`/`k`, or standard Arrow keys (retro sage selection aura glow) with prompt hotkey binds: `Enter` (focus), `d` (close), `s` (save), `f` (freeze).
> - **Satisfying Web Audio Sound Synthesis & Confetti Physics** swoosh, save, and combo completion sounds synthesized natively + high-fidelity micro-gravity confetti particles.
> - **Cyberpunk HUD Holographic Cursor** sleek laser targeting, physical spring dampening, and mouse hover/click compression shrink animations.
> - **Autocomplete Command Palette Search** press `/` or focus the top-right search box to expand it to `600px` and use `ArrowUp`/`ArrowDown`/`Enter` keyboard navigation to switch tabs instantly.
> - **Reboot Protection Session Snapshot** one-click non-destructive session backups that save to Chrome storage with a real-time `Restore Session (N)` button that automatically filters out duplicate tabs.
> - **Homepages group** pulls Gmail, X, LinkedIn, YouTube, GitHub homepages into one card for easy cleanup
> - **Duplicate detection** flags when you have the same page open twice with dynamic counts syncing.
> - **Click any tab title to jump to it** even across different Chrome windows
> - **Save for later checklist** bookmark individual tabs to an active checklist before closing them.
> - **Collapsible Archive list** with hover-to-reveal trash delete buttons and a cascade-offset **"Clear All"** domino slide-out clearing transition.
> - **Localhost port grouping** shows port numbers next to each localhost tab to separate vibe projects.
> - **High-Fidelity Native Favicons** extracts direct tab favicon URLs from Chrome with third-party Google service fallbacks.
> - **100% local** no server, no accounts, no data sent anywhere
>
> It's just a browser extension for Chrome and Edge. Setup takes about 1 minute.

---

## Step 1 -- Clone your copy of the project

```bash
git clone <your-fork-or-copy-url>
cd tab-out
```

---

## Step 2 -- Install the extension in Chrome or Edge

This is the one step that requires manual action from the user. Make it as easy as possible.

**First**, print the full path to the `extension/` folder:
```bash
echo "Extension folder: $(cd extension && pwd)"
```

**Then**, copy the `extension/` folder path to their clipboard:
- macOS: `cd extension && pwd | pbcopy && echo "Path copied to clipboard"`
- Linux: `cd extension && pwd | xclip -selection clipboard 2>/dev/null || echo "Path: $(pwd)"`
- Windows: `cd extension && echo %CD% | clip`

**Then**, open the extensions page:
```bash
open "chrome://extensions" # or "edge://extensions"
```

**Then**, walk the user through it step by step:

> I've copied the extension folder path to your clipboard. Now:
>
> 1. You should see your browser's extensions page. In the **top-right corner**, toggle on **Developer mode** (it's a switch).
> 2. Once Developer mode is on, you'll see a button called **"Load unpacked"** appear in the top-left. Click it.
> 3. A file picker will open. **Press Cmd+Shift+G** (Mac) or **Ctrl+L** (Windows/Linux) to open the "Go to folder" bar, then **paste** the path I copied (Cmd+V / Ctrl+V) and press Enter.
> 4. Click **"Select"** or **"Open"** and the extension will install.
>
> You should see "Tab Out" appear in your extensions list.

**Also**, open the file browser directly to the extension folder as a fallback:
- macOS: `open extension/`
- Linux: `xdg-open extension/`
- Windows: `explorer extension\\`

---

## Step 3 -- Show them around

Once the extension is loaded:

> You're all set! Open a **new tab** and you'll see Tab Out.
>
> Here's how it works:
> 1. **Your open tabs are grouped by domain** in a grid layout.
> 2. **Homepages** (Gmail inbox, X home, YouTube, etc.) are in their own group at the top.
> 3. **Click any tab title** to jump directly to that tab.
> 4. **Click the X** next to any tab to close just that one (with swoosh + confetti + dynamic count sync!).
> 5. **Click "Close all N tabs"** on a group to close the whole thing.
> 6. **Duplicate tabs** are flagged with an amber badge. Click "Close duplicates" to keep one copy and watch the counts synchronize instantly.
> 7. **Save a tab for later** by clicking the bookmark icon before closing it. Saved tabs appear in the sidebar.
> 8. **Tab Sleep & RAM Saver (💤/❄️)**: Active tabs display a freeze snowflake icon (`❄️`). Click it or click 'Freeze all' on cards to safely unload tabs from memory without closing them, displaying a breathing sleep `💤` badge. Plays a chilly sine-sweep chime!
> 9. **Workspace Session Manager**: Click 'Save Workspace' in the top bar to open an elegant checklist modal popup, choose exactly which tabs you want to include, input a custom name, and save. Manage and restore them in the right sidebar.
> 10. **Vim-style Keyboard Maestro**: Navigate everything mouse-free! Press `Tab`/`Shift-Tab` or `j`/`k` or Arrow keys to select tabs (highlighted with a retro sage glow), then press `Enter` to jump, `d` to close, `s` to save, or `f` to freeze.
> 11. **Search open tabs with / key**: focus the compact top-right search to watch it slide expand to `600px`, typing to filter and instantly navigating suggestions using arrow keys and `Enter`.
> 12. **Backup open tabs with Save Session**: capture a 100% safe, non-destructive background snapshot to Chrome storage, instantly showing a `Restore Session (N)` button.
> 13. **Archive and cascades**: manage completed checklists, hovering to delete permanently, or clicking the cascading slide-out "Clear All" button to clean up your history with high-fidelity physical responses.
> 14. **Theme Switcher**: Click the theme toggle button in the top bar to swap instantly between "Sage Paper" (retro-organic warm look) and "Cyber Deck" (matrix cyberpunk glowing look) complete with distinct synthesizer sweeps and matching confetti colors.

That's it! No server to run, no config files. Everything works right away.

---

## Key Facts

- Tab Out is a pure browser extension. No server, no Node.js, no npm.
- Saved tabs are stored in `chrome.storage.local` (persists across sessions).
- 100% local. No data is sent to any external service.
- To update: `cd tab-out && git pull`, then reload the extension in `chrome://extensions` or `edge://extensions`.
