/* ================================================================
   Tab Out — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];

// Track tab IDs that we close programmatically so onRemoved doesn't trigger full render and disrupt animations
const programmaticallyClosedTabIds = new Set();

// Track expanded workspace IDs to preserve accordion fold states between static dashboard renders
const expandedWorkspaceIds = new Set();

/**
 * removeTabsSafely(ids)
 *
 * Removes one or more tabs and flags them as programmatically closed
 * to prevent onRemoved event from disrupting tab exit animations.
 */
async function removeTabsSafely(ids) {
  const idsArray = Array.isArray(ids) ? ids : [ids];
  idsArray.forEach(id => programmaticallyClosedTabIds.add(id));
  try {
    await chrome.tabs.remove(ids);
  } catch (err) {
    console.warn('[tab-out] Could not remove tab:', err);
    idsArray.forEach(id => programmaticallyClosedTabIds.delete(id));
  }
}

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Tab Out's own pages.
 */
async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    // The new URL for this page is now index.html (not newtab.html)
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title,
      windowId: t.windowId,
      active:   t.active,
      favIconUrl: t.favIconUrl,
      discarded: t.discarded,
      // Flag Tab Out's own pages so we can detect duplicate new tabs
      isTabOut:
        t.url === newtabUrl ||
        t.url?.startsWith('chrome://newtab') ||
        t.url?.startsWith('edge://newtab'),
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes all open tabs whose hostname matches any of the given URLs.
 * After closing, re-fetches the tab list to keep our state accurate.
 *
 * Special case: file:// URLs are matched exactly (they have no hostname).
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;

  // Separate file:// URLs (exact match) from regular URLs (hostname match)
  const targetHostnames = [];
  const exactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable */ }
    }
  }

  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch { return false; }
    })
    .map(tab => tab.id);

  if (toClose.length > 0) await removeTabsSafely(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabsExact(urls)
 *
 * Closes tabs by exact URL match (not hostname). Used for landing pages
 * so closing "Gmail inbox" doesn't also close individual email threads.
 */
async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(t => urlSet.has(t.url)).map(t => t.id);
  if (toClose.length > 0) await removeTabsSafely(toClose);
  await fetchOpenTabs();
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];

  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }

  if (toClose.length > 0) await removeTabsSafely(toClose);
  await fetchOpenTabs();
  return toClose.length;
}

/**
 * closeTabOutDupes()
 *
 * Closes all duplicate Tab Out new-tab pages except the current one.
 */
async function closeTabOutDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl ||
    t.url?.startsWith('chrome://newtab') ||
    t.url?.startsWith('edge://newtab')
  );

  if (tabOutTabs.length <= 1) return 0;

  // Keep the active Tab Out tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await removeTabsSafely(toClose);
  await fetchOpenTabs();
  return toClose.length;
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false,             // true = checked off (archived)
       dismissed: false              // true = dismissed without reading
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabsForLater(tabs)
 *
 * Saves multiple tabs to the "Saved for Later" list in chrome.storage.local
 * in a single atomic transaction to prevent write-loop race conditions and quota exhaustion.
 * @param {Array<{ url: string, title: string, favIconUrl?: string }>} tabs
 */
async function saveTabsForLater(tabs) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const now = new Date().toISOString();

  tabs.forEach((tab, index) => {
    // Check if there is already an active (not completed, not dismissed) item with the same URL
    const existingActive = deferred.find(item => item.url === tab.url && !item.completed && !item.dismissed);
    
    if (existingActive) {
      // Prevent duplicate: update title and reset saved timestamp to now
      existingActive.title = tab.title;
      existingActive.favIconUrl = tab.favIconUrl || '';
      existingActive.savedAt = now;
    } else {
      // Add new item with robust unique ID
      const uniqueId = `${Date.now()}-${index}-${Math.floor(Math.random() * 1000)}`;
      deferred.push({
        id:         uniqueId,
        url:        tab.url,
        title:      tab.title,
        favIconUrl: tab.favIconUrl || '',
        savedAt:    now,
        completed:  false,
        dismissed:  false,
      });
    }
  });

  await chrome.storage.local.set({ deferred });
}

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string, favIconUrl?: string }} tab
 */
async function saveTabForLater(tab) {
  await saveTabsForLater([tab]);
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter(t => !t.dismissed);
  return {
    active:   visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/* ─── Combo Streak State & Logic ─────────────────────────────────────────── */
let comboCount = 0;
let comboTimeout = null;

/**
 * triggerCombo(tabsClosedCount)
 *
 * Tracks rapid successive tab closures and triggers a satisfying combo badge.
 */
function triggerCombo(tabsClosedCount) {
  if (tabsClosedCount <= 0) return;
  comboCount += tabsClosedCount;

  if (comboTimeout) clearTimeout(comboTimeout);

  if (comboCount >= 2) {
    showComboBadge(comboCount);
  }

  comboTimeout = setTimeout(() => {
    resetCombo();
  }, 2500);
}

/**
 * showComboBadge(count)
 *
 * Spawns and animates a physical combo streak badge in the bottom-right.
 */
function showComboBadge(count) {
  let el = document.getElementById('comboBadge');
  if (!el) {
    el = document.createElement('div');
    el.id = 'comboBadge';
    el.className = 'combo-badge';
    document.body.appendChild(el);
  }

  el.className = 'combo-badge';
  let flameIcon = '⚡️';
  if (count >= 5 && count < 10) {
    el.classList.add('tier-2');
    flameIcon = '🔥';
  } else if (count >= 10) {
    el.classList.add('tier-3');
    flameIcon = '🔥💥🔥';
  } else {
    el.classList.add('tier-1');
  }

  el.innerHTML = `<span class="combo-count">${count}x</span> Combo ${flameIcon}`;

  // Reset animations and bump
  el.classList.add('visible');
  el.classList.remove('bump');
  void el.offsetWidth; // force reflow
  el.classList.add('bump');

  // Milestone celebratory confetti from the corner!
  if (count === 5 || count === 10 || count === 15 || count % 10 === 0) {
    shootConfetti(window.innerWidth - 100, window.innerHeight - 100);
  }
}

/**
 * resetCombo()
 *
 * Smoothly hides the combo badge.
 */
function resetCombo() {
  const el = document.getElementById('comboBadge');
  if (el) {
    el.classList.remove('visible');
  }
  comboCount = 0;
}

/* ─── Web Audio API Synths ───────────────────────────────────────────────── */

let audioCtx = null;

/**
 * initAudioContext()
 *
 * Warm up the shared AudioContext synchronously inside the user's click gesture.
 * Crucial for avoiding the browser's autoplay policy blocking sound after await commands.
 */
function initAudioContext() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  } catch (err) {
    console.warn('[tab-out] AudioContext init failed:', err);
  }
}

/**
 * getAudioContext()
 *
 * Accessor for the shared robust AudioContext.
 */
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * playSaveSound()
 *
 * Synthesizes a cute, bubbly plop/droplet sound when tabs are saved for later.
 */
function playSaveSound() {
  try {
    const ctx = getAudioContext();
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, t);
    // Rapid upward frequency sweep creates a perfect "plop/bubble" sound
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.12);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.02); // quick attack
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15); // decay

    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  } catch (err) {
    console.error('[tab-out] playSaveSound error:', err);
  }
}

/**
 * playChimeSound()
 *
 * Synthesizes an arpeggiated major chord bell chime when completing a checklist item.
 */
function playChimeSound() {
  try {
    const ctx = getAudioContext();
    const t = ctx.currentTime;

    const freqs = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    const duration = 0.8;

    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);

      // Strummed note delay
      const noteDelay = idx * 0.03;

      gain.gain.setValueAtTime(0.001, t + noteDelay);
      gain.gain.linearRampToValueAtTime(0.05, t + noteDelay + 0.03); // gentle attack
      gain.gain.exponentialRampToValueAtTime(0.001, t + noteDelay + duration);

      osc.connect(gain).connect(ctx.destination);
      osc.start(t + noteDelay);
      osc.stop(t + noteDelay + duration + 0.1);
    });
  } catch (err) {
    console.error('[tab-out] playChimeSound error:', err);
  }
}

/**
 * playFreezeSound()
 *
 * Plays a cold, crystalline chime sound when tabs are frozen.
 * Built entirely with the Web Audio API — no sound files needed.
 */
function playFreezeSound() {
  try {
    const ctx = getAudioContext();
    const t = ctx.currentTime;

    // High crystalline sine wave tones that sweep up and fade with a bell ring
    const freqs = [880.00, 1174.66, 1567.98, 2093.00]; // A5, D6, G6, C7
    const duration = 0.6;

    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle'; // triangle is softer, like ice/bell
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.05, t + 0.15);

      const noteDelay = idx * 0.05;

      gain.gain.setValueAtTime(0.001, t + noteDelay);
      gain.gain.linearRampToValueAtTime(0.03, t + noteDelay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + noteDelay + duration);

      osc.connect(gain).connect(ctx.destination);
      osc.start(t + noteDelay);
      osc.stop(t + noteDelay + duration + 0.1);
    });
  } catch (err) {
    console.error('[tab-out] playFreezeSound error:', err);
  }
}

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = getAudioContext();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);
  } catch (err) {
    console.error('[tab-out] playCloseSound error:', err);
  }
}

/**
 * playSageThemeSound()
 *
 * Plays a warm, organic acoustic chime when switching to the Sage Green theme.
 * Built entirely with the Web Audio API.
 */
function playSageThemeSound() {
  try {
    const ctx = getAudioContext();
    const t = ctx.currentTime;

    const notes = [220.00, 277.18, 329.63, 440.00]; // A3, C#4, E4, A4 (A Major)
    const duration = 0.8;

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);

      const delay = idx * 0.08; // slow arpeggio/strum

      gain.gain.setValueAtTime(0.001, t + delay);
      gain.gain.linearRampToValueAtTime(0.06, t + delay + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + duration);

      osc.connect(gain).connect(ctx.destination);
      osc.start(t + delay);
      osc.stop(t + delay + duration + 0.1);
    });
  } catch (err) {
    console.error('[tab-out] playSageThemeSound error:', err);
  }
}

/**
 * playCyberThemeSound()
 *
 * Plays a high-tech digital sweep with low-to-high riser pitch-bend and high resonance.
 * Built entirely with the Web Audio API.
 */
function playCyberThemeSound() {
  try {
    const ctx = getAudioContext();
    const t = ctx.currentTime;

    // 1. Digital Synth Sweep
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, t);
    osc.frequency.exponentialRampToValueAtTime(600, t + 0.35);

    filter.type = 'lowpass';
    filter.Q.value = 5.0; // resonant
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(3500, t + 0.35);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.07, t + 0.05); // fast attack
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4); // fade out

    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.45);

    // 2. High digital beep on complete
    const beep = ctx.createOscillator();
    const beepGain = ctx.createGain();

    beep.type = 'sine';
    beep.frequency.setValueAtTime(1760, t + 0.25); // A6

    beepGain.gain.setValueAtTime(0.001, t + 0.25);
    beepGain.gain.linearRampToValueAtTime(0.04, t + 0.28);
    beepGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

    beep.connect(beepGain).connect(ctx.destination);
    beep.start(t + 0.25);
    beep.stop(t + 0.55);
  } catch (err) {
    console.error('[tab-out] playCyberThemeSound error:', err);
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 * Adapts colors dynamically to the active theme!
 */
function shootConfetti(x, y) {
  const isCyber = document.documentElement.classList.contains('theme-cyberpunk');
  const colors = isCyber ? [
    '#00f0ff', // cyan
    '#05f9ff', // light cyan
    '#ff007f', // magenta
    '#ff5ebd', // light pink
    '#8b5cf6', // purple
    '#a78bfa', // light purple
    '#39ff14', // neon green
  ] : [
    '#c8713a', // amber
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  const zenQuotes = [
    { title: "Today is a clean slate.", subtitle: "Take a deep breath and start fresh." },
    { title: "Inbox zero, but for tabs.", subtitle: "Your digital desk is completely clear." },
    { title: "Living in the moment.", subtitle: "No open loops, no background noise." },
    { title: "Ah, digital peace and quiet.", subtitle: "Time to make a warm cup of tea 🍵" },
    { title: "All clear. You did it.", subtitle: "Go ahead, close your browser and enjoy the day." },
    { title: "The workspace is clear.", subtitle: "Your focus is yours again." },
    { title: "Zero tabs, infinite potential.", subtitle: "What are you going to build next?" }
  ];
  const randomZen = zenQuotes[Math.floor(Math.random() * zenQuotes.length)];

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">${randomZen.title}</div>
      <div class="empty-subtitle">${randomZen.subtitle}</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 domains';
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return 'just now';
  if (diffMins < 60)  return diffMins + ' min ago';
  if (diffHours < 24) return diffHours + ' hr' + (diffHours !== 1 ? 's' : '') + ' ago';
  if (diffDays === 1) return 'yesterday';
  return diffDays + ' days ago';
}

/**
 * getGreeting() — "Good morning / afternoon / evening"
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * getDateDisplay() — "Friday, April 4, 2026"
 */
function getDateDisplay() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

/**
 * checkTabOutDupes()
 *
 * Counts how many Tab Out pages are open. If more than 1,
 * shows a banner offering to close the extras.
 */
function checkTabOutDupes() {
  const tabOutTabs = openTabs.filter(t => t.isTabOut);
  const banner  = document.getElementById('tabOutDupeBanner');
  const countEl = document.getElementById('tabOutDupeCount');
  if (!banner) return;

  if (tabOutTabs.length > 1) {
    if (countEl) countEl.textContent = tabOutTabs.length;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label    = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count    = urlCounts[tab.url] || 1;
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const isDiscarded = tab.discarded;
    const discardedClass = isDiscarded ? ' chip-discarded' : '';
    const sleepIcon = isDiscarded ? `<span class="chip-sleep-badge" title="Tab is sleeping (saves memory)">💤</span>` : '';
    const chipClass = (count > 1 ? ' chip-has-dupes' : '') + discardedClass;
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = tab.favIconUrl || (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '');
    const searchText = `${label} ${tab.url}`.toLowerCase().replace(/"/g, '&quot;');
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" data-search-text="${searchText}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="">` : ''}
      ${sleepIcon}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        ${!isDiscarded ? `
        <button class="chip-action chip-freeze" data-action="freeze-single-tab" data-tab-id="${tab.id}" title="Freeze this tab (Saves memory!)">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v18m0-18l-3 3m3-3l3 3m-3 15l-3-3m3 3l3-3M3 12h18M3 12l3-3m-3 3l3 3m15-3l-3-3m3 3l-3 3" /></svg>
        </button>
        ` : ''}
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group, groupIndex)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [{ url, title, id, windowId, active }] }
 */
function renderDomainCard(group) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tabCount} tab${tabCount !== 1 ? 's' : ''} open
  </span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--accent-amber);background:rgba(200,113,58,0.08);">
        ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </span>`
    : '';

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    // For localhost tabs, prepend port number so you can tell projects apart
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count    = urlCounts[tab.url];
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const isDiscarded = tab.discarded;
    const discardedClass = isDiscarded ? ' chip-discarded' : '';
    const sleepIcon = isDiscarded ? `<span class="chip-sleep-badge" title="Tab is sleeping (saves memory)">💤</span>` : '';
    const chipClass = (count > 1 ? ' chip-has-dupes' : '') + discardedClass;
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = tab.favIconUrl || (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '');
    const searchText = `${label} ${tab.url}`.toLowerCase().replace(/"/g, '&quot;');
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" data-search-text="${searchText}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="">` : ''}
      ${sleepIcon}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        ${!isDiscarded ? `
        <button class="chip-action chip-freeze" data-action="freeze-single-tab" data-tab-id="${tab.id}" title="Freeze this tab (Saves memory!)">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v18m0-18l-3 3m3-3l3 3m-3 15l-3-3m3 3l3-3M3 12h18M3 12l3-3m-3 3l3 3m15-3l-3-3m3 3l-3 3" /></svg>
        </button>
        ` : ''}
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  let actionsHtml = `
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      Close all ${tabCount} tab${tabCount !== 1 ? 's' : ''}
    </button>`;

  const hasActiveTabs = tabs.some(t => !t.discarded);
  if (hasActiveTabs) {
    actionsHtml += `
      <button class="action-btn freeze-tabs" data-action="freeze-domain-tabs" data-domain-id="${stableId}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 12px; height: 12px; margin-right: 4px; display: inline-block; vertical-align: middle;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v18m0-18l-3 3m3-3l3 3m-3 15l-3-3m3 3l3-3M3 12h18M3 12l3-3m-3 3l3 3m15-3l-3-3m3 3l-3 3" /></svg>
        Freeze all ${tabCount} tabs
      </button>`;
  }

  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        Close ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </button>`;
  }

  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${isLanding ? 'Homepages' : (group.label || friendlyDomain(group.domain))}</span>
          ${tabBadge}
          ${dupeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">tabs</div>
      </div>
    </div>`;
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Checklist Column
   ---------------------------------------------------------------- */

/**
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the right-side
 * "Saved for Later" checklist column. Shows active items as a checklist
 * and completed items in a collapsible archive.
 */
async function renderDeferredColumn() {
  const column         = document.getElementById('deferredColumn');
  const list           = document.getElementById('deferredList');
  const empty          = document.getElementById('deferredEmpty');
  const countEl        = document.getElementById('deferredCount');
  const archiveEl      = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');

  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();

    // Hide the entire column if there's nothing to show
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      return;
    }

    column.style.display = 'block';

    // Render active checklist items
    if (active.length > 0) {
      countEl.textContent = `${active.length} item${active.length !== 1 ? 's' : ''}`;
      list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    const btnClear = document.getElementById('btnClearArchive');
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
      if (btnClear) btnClear.style.display = 'inline-flex';
    } else {
      archiveEl.style.display = 'none';
      if (btnClear) btnClear.style.display = 'none';
    }

  } catch (err) {
    console.warn('[tab-out] Could not load saved tabs:', err);
    column.style.display = 'none';
  }
}

/**
 * renderDeferredItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = item.favIconUrl || (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '');
  const ago = timeAgo(item.savedAt);

  return `
    <div class="deferred-item" data-deferred-id="${item.id}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}">
      <div class="deferred-info">
        <a href="${item.url}" target="_blank" rel="noopener" class="deferred-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
          <img src="${faviconUrl}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px">${item.title || item.url}
        </a>
        <div class="deferred-meta">
          <span>${domain}</span>
          <span>${ago}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="Dismiss">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/**
 * renderArchiveItem(item)
 *
 * Builds HTML for one completed/archived item (simpler: just title + date).
 */
function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  return `
    <div class="archive-item" data-deferred-id="${item.id}">
      <a href="${item.url}" target="_blank" rel="noopener" class="archive-item-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
        ${item.title || item.url}
      </a>
      <span class="archive-item-date">${ago}</span>
      <button class="archive-dismiss" data-action="delete-archive" data-deferred-id="${item.id}" title="Delete permanently">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints greeting + date
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" checklist
 */
async function renderStaticDashboard() {
  selectedChipIndex = -1;
  // --- Header ---
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl)     dateEl.textContent     = getDateDisplay();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();

  // --- Group tabs by domain ---
  // Landing pages (Gmail inbox, Twitter home, etc.) get their own special group
  // so they can be closed together without affecting content tabs on the same domain.
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
    // Merge personal patterns from config.local.js (if it exists)
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        // Support both exact hostname and suffix matching (for wildcard subdomains)
        const hostnameMatch = p.hostname
          ? parsed.hostname === p.hostname
          : p.hostnameEndsWith
            ? parsed.hostname.endsWith(p.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];

  // Custom group rules from config.local.js (if any)
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  // Check if a URL matches a custom group rule; returns the rule or null
  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname
          ? parsed.hostname === r.hostname
          : r.hostnameEndsWith
            ? parsed.hostname.endsWith(r.hostnameEndsWith)
            : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true; // hostname matched, no path filter
      }) || null;
    } catch { return null; }
  }

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      // Check custom group rules first (e.g. merge subdomains, split by path)
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      let hostname;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // Sort: landing pages first, then domains from landing page sites, then by tab count
  // Collect exact hostnames and suffix patterns for priority sorting
  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }
  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  });

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Open tabs';
    openTabsSectionCount.innerHTML = `${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabs.length} tabs</button>`;
    openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = getRealTabs().length;

  // --- Check for duplicate Tab Out tabs ---
  checkTabOutDupes();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();

  // --- Render Saved Workspaces ---
  await renderWorkspaces();

  // --- Re-apply search filter if active ---
  const searchInput = document.getElementById('globalSearch');
  if (searchInput && searchInput.value) {
    filterTabs(searchInput.value);
  }

  // --- Update session snapshot action buttons ---
  await updateSessionButtonsVisibility();
}

async function renderDashboard() {
  await renderStaticDashboard();
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  // Synchronously warm up the shared AudioContext within the user's click gesture.
  // This is crucial because browser security policies block AudioContext from starting
  // after asynchronous tasks (like 'await' commands).
  initAudioContext();

  // ---- Handle Session Action Buttons (Snapshot & Restore) ----
  const saveBtn = e.target.closest('#btnSaveSession');
  if (saveBtn) {
    e.preventDefault();
    await saveCurrentSession();
    return;
  }

  const restoreBtn = e.target.closest('#btnRestoreSession');
  if (restoreBtn) {
    e.preventDefault();
    await restoreSession();
    return;
  }

  const themeBtn = e.target.closest('#btnThemeToggle');
  if (themeBtn) {
    e.preventDefault();
    const root = document.documentElement;
    const isCyber = root.classList.contains('theme-cyberpunk');
    const newTheme = isCyber ? 'sage-green' : 'cyberpunk-blue';

    // Persist theme to storage
    await chrome.storage.local.set({ theme: newTheme });
    applyTheme(newTheme);

    // Play satisfying theme audio feedback
    if (newTheme === 'cyberpunk-blue') {
      playCyberThemeSound();
    } else {
      playSageThemeSound();
    }

    // Shoot a gorgeous dynamic celebratory confetti burst from the toggle button!
    const rect = themeBtn.getBoundingClientRect();
    shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return;
  }

  const saveWsBtn = e.target.closest('#btnSaveWorkspace');
  if (saveWsBtn) {
    e.preventDefault();
    openWorkspaceModal();
    return;
  }

  const kbShortcutsBtn = e.target.closest('#btnKeyboardShortcuts');
  if (kbShortcutsBtn) {
    e.preventDefault();
    openKeyboardModal();
    return;
  }

  const kbCloseBtn = e.target.closest('#btnKeyboardModalClose') || e.target.closest('#btnKeyboardModalCloseOk');
  if (kbCloseBtn) {
    e.preventDefault();
    closeKeyboardModal();
    return;
  }

  // Backdrop click to close modals
  if (e.target.id === 'workspaceModalBackdrop') {
    e.preventDefault();
    closeWorkspaceModal();
    return;
  }
  if (e.target.id === 'keyboardModalBackdrop') {
    e.preventDefault();
    closeKeyboardModal();
    return;
  }

  const modalCloseBtn = e.target.closest('#btnWorkspaceModalClose') || e.target.closest('#btnWorkspaceModalCancel');
  if (modalCloseBtn) {
    e.preventDefault();
    closeWorkspaceModal();
    return;
  }

  const selectAllBtn = e.target.closest('#btnSelectAllTabs');
  if (selectAllBtn) {
    e.preventDefault();
    selectWorkspaceAll();
    return;
  }

  const selectNoneBtn = e.target.closest('#btnSelectNoneTabs');
  if (selectNoneBtn) {
    e.preventDefault();
    selectWorkspaceNone();
    return;
  }

  const modalSaveBtn = e.target.closest('#btnWorkspaceModalSave');
  if (modalSaveBtn) {
    e.preventDefault();
    await handleWorkspaceSave();
    return;
  }

  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  // ---- Close duplicate Tab Out tabs ----
  if (action === 'close-tabout-dupes') {
    const closedCount = await closeTabOutDupes();
    playCloseSound();
    triggerCombo(closedCount);
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast('Closed extra Tab Out tabs');
    await renderStaticDashboard();
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Freeze/Sleep a single tab ----
  if (action === 'freeze-single-tab') {
    e.stopPropagation();
    const tabIdStr = actionEl.dataset.tabId;
    if (!tabIdStr) return;
    const tabId = parseInt(tabIdStr, 10);
    
    try {
      await chrome.tabs.discard(tabId);
      playFreezeSound();
      showToast('Tab frozen successfully (saves RAM) ❄️');
      await fetchOpenTabs();
      await renderStaticDashboard();
    } catch (err) {
      console.error('[tab-out] Failed to freeze tab:', err);
    }
    return;
  }

  // ---- Freeze/Sleep all tabs in a domain group ----
  if (action === 'freeze-domain-tabs') {
    e.stopPropagation();
    const domainId = actionEl.dataset.domainId;
    if (!domainId) return;

    const groupCard = actionEl.closest('.mission-card');
    if (!groupCard) return;
    const freezeBtns = groupCard.querySelectorAll('[data-action="freeze-single-tab"]');
    
    let count = 0;
    for (const btn of freezeBtns) {
      const tabIdStr = btn.dataset.tabId;
      if (tabIdStr) {
        const tabId = parseInt(tabIdStr, 10);
        try {
          await chrome.tabs.discard(tabId);
          count++;
        } catch {}
      }
    }

    if (count > 0) {
      playFreezeSound();
      showToast(`Frozen ${count} tab${count !== 1 ? 's' : ''} in group ❄️`);
      await fetchOpenTabs();
      await renderStaticDashboard();
    }
    return;
  }

  // ---- Toggle named workspace fold ----
  if (action === 'toggle-workspace-fold') {
    e.stopPropagation();
    // Support clicking both headers and lists via data-ws-id
    const wsId = actionEl.dataset.wsId;
    if (!wsId) return;

    const arrow = document.querySelector(`.workspace-toggle-arrow[data-ws-id="${wsId}"]`);
    const list = document.querySelector(`.workspace-preview-list[data-ws-id="${wsId}"]`);

    if (expandedWorkspaceIds.has(wsId)) {
      expandedWorkspaceIds.delete(wsId);
      if (arrow) arrow.classList.remove('expanded');
      if (list) list.classList.remove('expanded');
    } else {
      expandedWorkspaceIds.add(wsId);
      if (arrow) arrow.classList.add('expanded');
      if (list) list.classList.add('expanded');
    }
    return;
  }

  // ---- Restore single tab from workspace ----
  if (action === 'restore-single-ws-tab') {
    e.stopPropagation();
    const url = actionEl.dataset.url;
    if (!url) return;

    playChimeSound();
    const currentlyOpenUrls = new Set(openTabs.map(t => t.url));
    if (currentlyOpenUrls.has(url)) {
      showToast('This tab is already open!');
      // Find the tab and focus it
      const openTab = openTabs.find(t => t.url === url);
      if (openTab) {
        chrome.tabs.update(openTab.id, { active: true });
        chrome.windows.update(openTab.windowId, { focused: true });
      }
    } else {
      try {
        await chrome.tabs.create({ url, active: false });
        showToast('Opened tab in background');
        await fetchOpenTabs();
        await renderStaticDashboard();
      } catch (err) {
        console.error('[tab-out] Failed to open workspace tab:', err);
      }
    }
    return;
  }

  // ---- Restore a named workspace ----
  if (action === 'restore-workspace') {
    e.stopPropagation();
    const wsId = actionEl.dataset.wsId;
    if (!wsId) return;

    const { workspaces = [] } = await chrome.storage.local.get('workspaces');
    const ws = workspaces.find(w => w.id === wsId);
    if (!ws) return;

    playChimeSound();
    const currentlyOpenUrls = new Set(openTabs.map(t => t.url));
    const urlsToRestore = ws.urls.filter(url => !currentlyOpenUrls.has(url));

    if (urlsToRestore.length > 0) {
      try {
        await Promise.all(urlsToRestore.map(url => chrome.tabs.create({ url, active: false })));
      } catch (err) {
        console.error('[tab-out] Failed to restore workspace tabs:', err);
      }
    }

    showToast(`Restored workspace "${ws.name}" (${urlsToRestore.length} tabs)!`);
    await fetchOpenTabs();
    await renderStaticDashboard();
    return;
  }

  // ---- Delete a named workspace ----
  if (action === 'delete-workspace') {
    e.stopPropagation();
    const wsId = actionEl.dataset.wsId;
    if (!wsId) return;

    if (!confirm("Are you sure you want to delete this workspace?")) return;

    const { workspaces = [] } = await chrome.storage.local.get('workspaces');
    const updated = workspaces.filter(w => w.id !== wsId);
    await chrome.storage.local.set({ workspaces: updated });

    playCloseSound();
    showToast("Workspace deleted");
    await renderWorkspaces();
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    // Close the tab in Chrome directly
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await removeTabsSafely(match.id);
    await fetchOpenTabs();

    playCloseSound();
    triggerCombo(1);
    if (window.notifyPetAction) window.notifyPetAction('close');

    // Animate the chip row out (slides left to discard)
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.25s cubic-bezier(0.25, 0.8, 0.25, 1), transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1)';
      chip.style.opacity    = '0';
      chip.style.transform  = 'translateX(-30px) scale(0.95)';
      setTimeout(() => {
        const parentCard = chip.closest('.mission-card');
        chip.remove();

        if (parentCard) {
          const remainingChips = parentCard.querySelectorAll('.page-chip').length;
          if (remainingChips === 0) {
            animateCardOut(parentCard);
          } else {
            // Update card header tab badge dynamically
            const badge = parentCard.querySelector('.open-tabs-badge');
            if (badge) {
              badge.innerHTML = `${ICONS.tabs} ${remainingChips} tab${remainingChips !== 1 ? 's' : ''} open`;
            }
            // Update card footer close button dynamically
            const closeBtn = parentCard.querySelector('[data-action="close-domain-tabs"]');
            if (closeBtn) {
              closeBtn.innerHTML = `${ICONS.close} Close all ${remainingChips} tab${remainingChips !== 1 ? 's' : ''}`;
            }
          }
        }

        // Update global "Close all N tabs" button count dynamically
        const totalRealTabsLeft = getRealTabs().length;
        const closeAllBtn = document.querySelector('[data-action="close-all-open-tabs"]');
        if (closeAllBtn) {
          closeAllBtn.innerHTML = `${ICONS.close} Close all ${totalRealTabsLeft} tabs`;
        }
      }, 200);
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = getRealTabs().length;

    showToast('Tab closed');
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // Save to chrome.storage.local
    try {
      const allTabs = await chrome.tabs.query({});
      const match   = allTabs.find(t => t.url === tabUrl);
      await saveTabForLater({
        url: tabUrl,
        title: tabTitle,
        favIconUrl: match ? match.favIconUrl : ''
      });
      playSaveSound();
      if (window.notifyPetAction) window.notifyPetAction('save');
    } catch (err) {
      console.error('[tab-out] Failed to save tab:', err);
      showToast('Failed to save tab');
      return;
    }

    // Close the tab in Chrome
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await removeTabsSafely(match.id);
    await fetchOpenTabs();

    // Animate chip out (slides right towards Saved for Later sidebar)
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.25s cubic-bezier(0.25, 0.8, 0.25, 1), transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1)';
      chip.style.opacity    = '0';
      chip.style.transform  = 'translateX(30px) scale(0.95)';
      setTimeout(() => {
        const parentCard = chip.closest('.mission-card');
        chip.remove();

        if (parentCard) {
          const remainingChips = parentCard.querySelectorAll('.page-chip').length;
          if (remainingChips === 0) {
            animateCardOut(parentCard);
          } else {
            // Update card header tab badge dynamically
            const badge = parentCard.querySelector('.open-tabs-badge');
            if (badge) {
              badge.innerHTML = `${ICONS.tabs} ${remainingChips} tab${remainingChips !== 1 ? 's' : ''} open`;
            }
            // Update card footer close button dynamically
            const closeBtn = parentCard.querySelector('[data-action="close-domain-tabs"]');
            if (closeBtn) {
              closeBtn.innerHTML = `${ICONS.close} Close all ${remainingChips} tab${remainingChips !== 1 ? 's' : ''}`;
            }
          }
        }

        // Update global "Close all N tabs" button count dynamically
        const totalRealTabsLeft = getRealTabs().length;
        const closeAllBtn = document.querySelector('[data-action="close-all-open-tabs"]');
        if (closeAllBtn) {
          closeAllBtn.innerHTML = `${ICONS.close} Close all ${totalRealTabsLeft} tabs`;
        }
      }, 250);
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = getRealTabs().length;

    showToast('Saved for later');
    await renderDeferredColumn();
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);
    playChimeSound();

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDeferredColumn(); // refresh counts and archive
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id);

    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn();
      }, 300);
    }
    return;
  }

  // ---- Delete an archived/completed tab permanently ----
  if (action === 'delete-archive') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id); // dismiss sets dismissed=true, which filters it out forever

    const item = actionEl.closest('.archive-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn();
      }, 300);
    }
    return;
  }

  // ---- Clear ALL archived items permanently ----
  if (action === 'clear-archive') {
    const { deferred = [] } = await chrome.storage.local.get('deferred');
    
    // Set dismissed=true on ALL completed items so they vanish permanently
    deferred.forEach(item => {
      if (item.completed) {
        item.dismissed = true;
      }
    });

    await chrome.storage.local.set({ deferred });

    // Animate all archive items sliding away
    const items = document.querySelectorAll('.archive-item');
    items.forEach((item, index) => {
      setTimeout(() => {
        item.classList.add('removing');
      }, index * 40); // cascading slide-out effect
    });

    setTimeout(() => {
      renderDeferredColumn();
      showToast('Archive cleared permanently');
    }, Math.max(300, items.length * 40 + 150));
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    const urls      = group.tabs.map(t => t.url);
    // Landing pages and custom groups (whose domain key isn't a real hostname)
    // must use exact URL matching to avoid closing unrelated tabs
    const useExact  = group.domain === '__landing-pages__' || !!group.label;

    if (useExact) {
      await closeTabsExact(urls);
    } else {
      await closeTabsByUrls(urls);
    }

    if (card) {
      playCloseSound();
      animateCardOut(card);
      triggerCombo(group.tabs.length);
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain));
    showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${groupLabel}`);

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = getRealTabs().length;
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    const closedCount = await closeDuplicateTabs(urls, true);
    playCloseSound();
    triggerCombo(closedCount);

    // Hide the dedup button and trigger full UI update when animation completes
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity    = '0';
    setTimeout(async () => {
      actionEl.remove();
      await renderStaticDashboard();
    }, 200);

    // Remove dupe badges from the card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity    = '0';
        setTimeout(() => b.remove(), 200);
      });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent.includes('duplicate')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity    = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
    }

    showToast('Closed duplicates, kept one copy each');
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();
    triggerCombo(allUrls.length);

    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
      animateCardOut(c);
    });

    showToast('All tabs closed. Fresh start.');
    return;
  }
});

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.classList.toggle('open');
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const { archived } = await getSavedTabs();

    if (q.length < 2) {
      // Show all archived items
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      return;
    }

    // Filter by title or URL containing the query string
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url  || '').toLowerCase().includes(q)
    );

    archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
      || '<div style="font-size:12px;color:var(--muted);padding:8px 0">No results</div>';
  } catch (err) {
    console.warn('[tab-out] Archive search failed:', err);
  }
});


/* ----------------------------------------------------------------
   GLOBAL SEARCH & LIVE FILTERING
   ---------------------------------------------------------------- */

/**
 * filterTabs(query)
 *
 * Synchronously filters DOM elements (.page-chip) and (.mission-card)
 * based on the user's search query, and toggles the empty state.
 */
function filterTabs(query) {
  const q = query.trim().toLowerCase();
  
  const chips = document.querySelectorAll('.page-chip[data-search-text]');
  const cards = document.querySelectorAll('.mission-card');
  const emptyState = document.getElementById('searchEmptyState');
  
  if (!q) {
    // Reset everything
    chips.forEach(chip => {
      chip.classList.remove('filtered-out');
      // Restore original text (removing highlights)
      const textSpan = chip.querySelector('.chip-text');
      if (textSpan && textSpan.dataset.originalText) {
        textSpan.innerHTML = textSpan.dataset.originalText;
      }
    });
    
    cards.forEach(card => {
      card.classList.remove('card-hidden');
      // Reset overflow containers if they were expanded due to search
      const overflow = card.querySelector('.page-chips-overflow');
      if (overflow && overflow.dataset.wasAutoExpanded) {
        overflow.style.display = 'none';
        delete overflow.dataset.wasAutoExpanded;
        // Re-add expansion link if it was hidden
        const expandBtn = card.querySelector('[data-action="expand-chips"]');
        if (expandBtn) expandBtn.style.display = 'flex';
      }
    });
    
    if (emptyState) emptyState.style.display = 'none';
    return;
  }
  
  // Track visible cards
  let visibleCardCount = 0;
  
  cards.forEach(card => {
    const cardChips = card.querySelectorAll('.page-chip[data-search-text]');
    let hasMatchInCard = false;
    let hasMatchInOverflow = false;
    
    cardChips.forEach(chip => {
      const text = chip.dataset.searchText || '';
      const textSpan = chip.querySelector('.chip-text');
      
      // Store original text for restoring later
      if (textSpan && !textSpan.dataset.originalText) {
        textSpan.dataset.originalText = textSpan.innerHTML;
      }
      
      if (text.includes(q)) {
        chip.classList.remove('filtered-out');
        hasMatchInCard = true;
        
        // Check if chip is inside the overflow container
        if (chip.parentElement.classList.contains('page-chips-overflow')) {
          hasMatchInOverflow = true;
        }
        
        // Highlight matched text
        if (textSpan) {
          const original = textSpan.dataset.originalText;
          const regex = new RegExp(`(${escapeRegExp(q)})`, 'gi');
          textSpan.innerHTML = original.replace(regex, '<span class="search-highlight">$1</span>');
        }
      } else {
        chip.classList.add('filtered-out');
        // Restore original text if not matched
        if (textSpan && textSpan.dataset.originalText) {
          textSpan.innerHTML = textSpan.dataset.originalText;
        }
      }
    });
    
    // Auto-expand overflow container if a match is found inside it
    const overflow = card.querySelector('.page-chips-overflow');
    const expandBtn = card.querySelector('[data-action="expand-chips"]');
    if (overflow) {
      if (hasMatchInOverflow) {
        overflow.style.display = 'contents';
        overflow.dataset.wasAutoExpanded = 'true';
        if (expandBtn) expandBtn.style.display = 'none';
      } else {
        // If no match in overflow, hide it unless it was manually expanded
        if (overflow.dataset.wasAutoExpanded) {
          overflow.style.display = 'none';
          delete overflow.dataset.wasAutoExpanded;
          if (expandBtn) expandBtn.style.display = 'flex';
        }
      }
    }
    
    if (hasMatchInCard) {
      card.classList.remove('card-hidden');
      visibleCardCount++;
    } else {
      card.classList.add('card-hidden');
    }
  });
  
  // Toggle zero matches empty state
  if (emptyState) {
    emptyState.style.display = visibleCardCount === 0 ? 'block' : 'none';
  }
}

/**
 * escapeRegExp(string)
 *
 * Helper to escape special characters for regex matching.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---- Global tab search — filter open tabs as user types ----
// State for search autocomplete dropdown keyboard navigation
let activeDropdownIndex = -1;
let dropdownMatches = [];

// State for global dashboard keyboard navigation (Vim / Tab selection)
let selectedChipIndex = -1;

/**
 * updateSearchDropdown(query)
 *
 * Populates the autocomplete dropdown with matched tabs, highlighting query text,
 * and handles show/hide logic.
 */
function updateSearchDropdown(query) {
  const dropdown = document.getElementById('searchDropdown');
  if (!dropdown) return;

  const q = query.trim().toLowerCase();
  if (!q) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
    dropdownMatches = [];
    activeDropdownIndex = -1;
    return;
  }

  // Find all matching open tabs (excluding Tab Out's own page)
  const realTabs = getRealTabs();
  dropdownMatches = realTabs.filter(t => 
    (t.title || '').toLowerCase().includes(q) || 
    (t.url || '').toLowerCase().includes(q)
  );

  if (dropdownMatches.length === 0) {
    dropdown.innerHTML = '<div class="dropdown-no-results">No suggestions found</div>';
    dropdown.style.display = 'block';
    activeDropdownIndex = -1;
    return;
  }

  // Limit to top 6 results for premium, readable HUD dropdown
  const displayMatches = dropdownMatches.slice(0, 6);
  dropdownMatches = displayMatches; // Keep state in sync with rendered elements
  activeDropdownIndex = 0; // Default to first item selected for instant press-Enter ease

  const itemsHtml = displayMatches.map((tab, idx) => {
    let domain = '';
    try { domain = new URL(tab.url).hostname.replace(/^www\./, ''); } catch {}
    const faviconUrl = tab.favIconUrl || (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '');
    const activeClass = idx === 0 ? ' active' : '';

    // Highlight matches in title and URL
    const title = tab.title || tab.url;
    const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
    const highlightedTitle = title.replace(regex, '<span class="search-highlight">$1</span>');
    const highlightedUrl = tab.url.replace(regex, '<span class="search-highlight">$1</span>');

    return `
      <div class="dropdown-item${activeClass}" data-index="${idx}" data-url="${encodeURIComponent(tab.url)}">
        ${faviconUrl ? `<img class="dropdown-favicon" src="${faviconUrl}" alt="">` : ''}
        <div class="dropdown-info">
          <div class="dropdown-title">${highlightedTitle}</div>
          <div class="dropdown-url">${highlightedUrl}</div>
        </div>
      </div>
    `;
  }).join('');

  dropdown.innerHTML = itemsHtml;
  dropdown.style.display = 'block';
}

/**
 * updateActiveDropdownItem()
 *
 * Synchronizes the .active class on the dropdown elements and scrolls them into view.
 */
function updateActiveDropdownItem() {
  const items = document.querySelectorAll('.dropdown-item');
  items.forEach((item, idx) => {
    if (idx === activeDropdownIndex) {
      item.classList.add('active');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('active');
    }
  });
}

document.addEventListener('input', (e) => {
  if (e.target.id !== 'globalSearch') return;
  filterTabs(e.target.value);
  updateSearchDropdown(e.target.value);
});

// ---- Key bindings for quick search and escape ----
document.addEventListener('keydown', (e) => {
  const workspaceModalBackdrop = document.getElementById('workspaceModalBackdrop');
  const isModalOpen = workspaceModalBackdrop && workspaceModalBackdrop.classList.contains('visible');
  
  if (isModalOpen) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeWorkspaceModal();
    }
    return;
  }

  const keyboardModalBackdrop = document.getElementById('keyboardModalBackdrop');
  const isKbModalOpen = keyboardModalBackdrop && keyboardModalBackdrop.classList.contains('visible');

  if (isKbModalOpen) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeKeyboardModal();
    }
    return;
  }

  const active = document.activeElement;
  const isInput = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable;
  
  // Press '/' to search
  if (e.key === '/' && !isInput) {
    e.preventDefault();
    const searchInput = document.getElementById('globalSearch');
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }
  
  // Press 'Esc' to clear and blur
  if (e.key === 'Escape' && active.id === 'globalSearch') {
    active.value = '';
    filterTabs('');
    updateSearchDropdown('');
    active.blur();
  }

  // Intercept ArrowUp/ArrowDown/Enter keys inside search bar for autocomplete list navigation
  if (active.id === 'globalSearch') {
    const hasMatches = dropdownMatches.length > 0;

    if (e.key === 'ArrowDown' && hasMatches) {
      e.preventDefault();
      activeDropdownIndex = (activeDropdownIndex + 1) % dropdownMatches.length;
      updateActiveDropdownItem();
    } else if (e.key === 'ArrowUp' && hasMatches) {
      e.preventDefault();
      activeDropdownIndex = (activeDropdownIndex - 1 + dropdownMatches.length) % dropdownMatches.length;
      updateActiveDropdownItem();
    } else if (e.key === 'Enter' && hasMatches && activeDropdownIndex >= 0) {
      e.preventDefault();
      const targetTab = dropdownMatches[activeDropdownIndex];
      if (targetTab && targetTab.url) {
        focusTab(targetTab.url);
        // Reset search
        active.value = '';
        filterTabs('');
        updateSearchDropdown('');
        active.blur();
      }
    }
  }

  // ---- Global Dashboard Keyboard Navigation (Vim-style & Tab navigation) ----
  if (!isInput) {
    const visibleChips = Array.from(document.querySelectorAll('.page-chip')).filter(chip => {
      const parentOverflow = chip.closest('.page-chips-overflow');
      if (parentOverflow && parentOverflow.style.display === 'none') return false;
      const card = chip.closest('.mission-card');
      if (card && card.style.display === 'none') return false;
      return chip.style.display !== 'none';
    });

    if (visibleChips.length > 0) {
      let changed = false;

      if (e.key === 'Tab' || e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (e.shiftKey) {
          selectedChipIndex = (selectedChipIndex - 1 + visibleChips.length) % visibleChips.length;
        } else {
          selectedChipIndex = (selectedChipIndex + 1) % visibleChips.length;
        }
        changed = true;
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        selectedChipIndex = (selectedChipIndex - 1 + visibleChips.length) % visibleChips.length;
        changed = true;
      } else if (e.key === 'Escape') {
        selectedChipIndex = -1;
        changed = true;
      } else if (e.key === 'Enter' && selectedChipIndex >= 0 && visibleChips[selectedChipIndex]) {
        e.preventDefault();
        const url = visibleChips[selectedChipIndex].dataset.tabUrl;
        if (url) focusTab(url);
      } else if (e.key === 'd' && selectedChipIndex >= 0 && visibleChips[selectedChipIndex]) {
        e.preventDefault();
        const closeBtn = visibleChips[selectedChipIndex].querySelector('.chip-close');
        if (closeBtn) {
          closeBtn.click();
          setTimeout(() => { selectedChipIndex = Math.min(selectedChipIndex, visibleChips.length - 2); }, 300);
        }
      } else if (e.key === 's' && selectedChipIndex >= 0 && visibleChips[selectedChipIndex]) {
        e.preventDefault();
        const saveBtn = visibleChips[selectedChipIndex].querySelector('.chip-save');
        if (saveBtn) {
          saveBtn.click();
          setTimeout(() => { selectedChipIndex = Math.min(selectedChipIndex, visibleChips.length - 2); }, 300);
        }
      } else if (e.key === 'f' && selectedChipIndex >= 0 && visibleChips[selectedChipIndex]) {
        e.preventDefault();
        const freezeBtn = visibleChips[selectedChipIndex].querySelector('.chip-freeze');
        if (freezeBtn) {
          freezeBtn.click();
        }
      }

      if (changed) {
        document.querySelectorAll('.page-chip').forEach(c => c.classList.remove('chip-keyboard-selected'));
        if (selectedChipIndex >= 0 && visibleChips[selectedChipIndex]) {
          visibleChips[selectedChipIndex].classList.add('chip-keyboard-selected');
          visibleChips[selectedChipIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
  }
});

// ---- Handle clicking on dropdown item or clicking outside to close it ----
document.addEventListener('click', (e) => {
  const dropdownItem = e.target.closest('.dropdown-item');
  if (dropdownItem) {
    const url = decodeURIComponent(dropdownItem.dataset.url);
    if (url) {
      focusTab(url);
      const searchInput = document.getElementById('globalSearch');
      if (searchInput) {
        searchInput.value = '';
        filterTabs('');
        updateSearchDropdown('');
        searchInput.blur();
      }
    }
    return;
  }

  // Click outside to close dropdown
  if (!e.target.closest('.search-container')) {
    const dropdown = document.getElementById('searchDropdown');
    if (dropdown) dropdown.style.display = 'none';
  }
});

// ---- Capture image load errors and hide broken favicons without violating CSP ----
document.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG') {
    e.target.style.display = 'none';
  }
}, true); // Use capturing phase because 'error' event does not bubble!


// ---- Auto-update dashboard in real-time when browser tabs change ----
chrome.tabs.onCreated.addListener(() => {
  renderStaticDashboard();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Only re-render if URL, title, or loading status changed to avoid redundant layout repaints
  if (changeInfo.url || changeInfo.title || changeInfo.status === 'complete') {
    renderStaticDashboard();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  // If the tab was closed programmatically from our UI, let the UI animation handle it
  // and do not trigger a full re-render that would disrupt the active animation.
  if (programmaticallyClosedTabIds.has(tabId)) {
    programmaticallyClosedTabIds.delete(tabId);
    return;
  }
  renderStaticDashboard();
});


// ---- Cyberpunk/HUD Sci-fi Custom Cursor Animation Engine ----
function initTechCursor() {
  const dot = document.getElementById('techCursorDot');
  const ring = document.getElementById('techCursorRing');
  const html = document.documentElement;

  if (!dot || !ring) return;

  // Only activate custom cursor on devices that support hover (e.g. desktops with mice)
  if (!window.matchMedia('(hover: hover)').matches) {
    return;
  }

  html.classList.add('has-custom-cursor');

  let mouseX = -100;
  let mouseY = -100;
  let ringX = -100;
  let ringY = -100;
  let isHovering = false;
  let isFirstMove = true;

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    
    if (isFirstMove) {
      ringX = mouseX;
      ringY = mouseY;
      isFirstMove = false;
    }
    
    // Dot instantly follows the mouse pointer for pixel-perfect responsiveness
    dot.style.left = `${mouseX}px`;
    dot.style.top = `${mouseY}px`;
    
    // Dynamic hover target detection
    const target = e.target;
    const isInteractive = target.closest('a, button, input, .clickable, .page-chip, .archive-toggle, .deferred-checkbox, .deferred-dismiss');
    
    if (isInteractive && !isHovering) {
      isHovering = true;
      html.classList.add('cursor-hovering');
    } else if (!isInteractive && isHovering) {
      isHovering = false;
      html.classList.remove('cursor-hovering');
    }
  });

  // Smooth floating orbit animation via Lerp (Linear Interpolation) inside requestAnimationFrame
  function updateRingPosition() {
    // 0.15 is the interpolation factor (the smaller, the smoother/more floaty the delay)
    ringX += (mouseX - ringX) * 0.15;
    ringY += (mouseY - ringY) * 0.15;

    ring.style.left = `${ringX}px`;
    ring.style.top = `${ringY}px`;

    requestAnimationFrame(updateRingPosition);
  }
  requestAnimationFrame(updateRingPosition);

  // Click pulse compress state
  document.addEventListener('mousedown', () => {
    html.classList.add('cursor-clicking');
  });

  document.addEventListener('mouseup', () => {
    html.classList.remove('cursor-clicking');
  });

  // Hide cursor on leaving browser window boundary
  document.addEventListener('mouseleave', () => {
    dot.style.opacity = '0';
    ring.style.opacity = '0';
  });

  document.addEventListener('mouseenter', () => {
    dot.style.opacity = '1';
    ring.style.opacity = '1';
  });
}


/* ----------------------------------------------------------------
   SESSION BACKUP & ONE-KEY RESTORE (REBOOT PROTECTION)
   ---------------------------------------------------------------- */

/**
 * saveCurrentSession()
 *
 * One-key save all current open real tabs to "Saved for Later" checklist
 * and backup their URLs for instant restoration.
 */
async function saveCurrentSession() {
  const realTabs = getRealTabs();
  if (realTabs.length === 0) {
    showToast('No open tabs to save!');
    return;
  }

  // Play satisfying save sound
  playSaveSound();

  // Backup these URLs specifically as the last session
  const urls = realTabs.map(t => t.url);
  await chrome.storage.local.set({ last_session_backup: urls });

  // Re-fetch and update UI to show the Restore Session button with count
  await renderStaticDashboard();
  
  showToast(`Backed up session with ${urls.length} tab${urls.length !== 1 ? 's' : ''}! Safe to reboot at any time.`);
}

/**
 * restoreSession()
 *
 * One-key restore all tabs saved in the last session, and archive them
 * from the checklist.
 */
async function restoreSession() {
  const { last_session_backup = [] } = await chrome.storage.local.get('last_session_backup');
  if (last_session_backup.length === 0) {
    showToast('No saved session found!');
    return;
  }

  // Play combo/restore sound
  playChimeSound();

  // Get currently open URLs to avoid opening duplicates of tabs that are already open
  const currentlyOpenUrls = new Set(openTabs.map(t => t.url));
  const urlsToRestore = last_session_backup.filter(url => !currentlyOpenUrls.has(url));

  if (urlsToRestore.length > 0) {
    // Create new tabs in the background in parallel and wait for all of them to be registered,
    // preventing a race condition where fetchOpenTabs runs before the tabs are created in Chrome.
    try {
      await Promise.all(urlsToRestore.map(url => chrome.tabs.create({ url, active: false })));
    } catch (err) {
      console.error('[tab-out] Failed to restore some tabs:', err);
    }
  }

  // Update check-list: complete/archive those URLs
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const backupSet = new Set(last_session_backup);
  deferred.forEach(item => {
    if (backupSet.has(item.url)) {
      item.completed = true;
    }
  });

  // Clear session backup
  await chrome.storage.local.set({ deferred, last_session_backup: [] });

  // Re-fetch and update UI (this will also hide the Restore Session button)
  await renderStaticDashboard();

  if (urlsToRestore.length === 0) {
    showToast('All tabs from this session are already open!');
  } else {
    showToast(`Restored ${urlsToRestore.length} closed tab${urlsToRestore.length !== 1 ? 's' : ''}!`);
  }
}

/**
 * updateSessionButtonsVisibility()
 *
 * Keeps the "Restore Session" button synced with the backup status.
 */
async function updateSessionButtonsVisibility() {
  const btnRestore = document.getElementById('btnRestoreSession');
  if (!btnRestore) return;

  const { last_session_backup = [] } = await chrome.storage.local.get('last_session_backup');
  if (last_session_backup && last_session_backup.length > 0) {
    btnRestore.style.display = 'inline-flex';
    btnRestore.querySelector('span').textContent = `Restore Session (${last_session_backup.length})`;
  } else {
    btnRestore.style.display = 'none';
  }
}

/**
 * escapeHtml(str)
 *
 * Escapes HTML characters to prevent XSS.
 */
function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * openWorkspaceModal()
 *
 * Populates and opens the Workspace selection modal popup.
 */
function openWorkspaceModal() {
  const backdrop = document.getElementById('workspaceModalBackdrop');
  const nameInput = document.getElementById('workspaceNameInput');
  const tabsList = document.getElementById('workspaceModalTabsList');
  if (!backdrop || !nameInput || !tabsList) return;

  // Clear name and set placeholder/default value
  nameInput.value = "Workspace " + new Date().toLocaleDateString();

  // Populate tabs list with checkboxes grouped by domain
  const realTabs = getRealTabs();
  if (realTabs.length === 0) {
    showToast('No open tabs to save!');
    return;
  }

  const groupMap = {};
  for (const tab of realTabs) {
    let domain = 'Other';
    try {
      if (tab.url && tab.url.startsWith('file://')) {
        domain = 'Local Files';
      } else if (tab.url) {
        const hostname = new URL(tab.url).hostname;
        domain = hostname.replace(/^www\./, '') || 'Other';
      }
    } catch {
      domain = 'Other';
    }
    if (!groupMap[domain]) groupMap[domain] = [];
    groupMap[domain].push(tab);
  }

  let html = '';
  const sortedDomains = Object.keys(groupMap).sort();
  for (const domain of sortedDomains) {
    html += `<div class="modal-group-title">${escapeHtml(domain)}</div>`;
    const tabs = groupMap[domain];
    for (const tab of tabs) {
      const escapedTitle = escapeHtml(tab.title || tab.url || 'Untitled');
      const escapedUrl = escapeHtml(tab.url || '');
      const faviconUrl = tab.favIconUrl || 'icons/icon16.png';
      html += `
        <label class="modal-tab-item">
          <input type="checkbox" class="modal-tab-checkbox" data-tab-id="${tab.id}" data-url="${escapedUrl}" checked>
          <img class="modal-tab-favicon" src="${faviconUrl}" onerror="this.src='icons/icon16.png';">
          <span class="modal-tab-title" title="${escapedTitle}">${escapedTitle}</span>
        </label>
      `;
    }
  }

  tabsList.innerHTML = html;

  // Show modal with animation
  backdrop.classList.add('visible');

  // Focus the name input and select its text
  setTimeout(() => {
    nameInput.focus();
    nameInput.select();
  }, 100);
}

/**
 * closeWorkspaceModal()
 *
 * Closes the Workspace selection modal popup.
 */
function closeWorkspaceModal() {
  const backdrop = document.getElementById('workspaceModalBackdrop');
  if (backdrop) {
    backdrop.classList.remove('visible');
  }
}

/**
 * openKeyboardModal()
 *
 * Opens the Keyboard Shortcuts modal popup.
 */
function openKeyboardModal() {
  const backdrop = document.getElementById('keyboardModalBackdrop');
  if (backdrop) {
    backdrop.classList.add('visible');
  }
}

/**
 * closeKeyboardModal()
 *
 * Closes the Keyboard Shortcuts modal popup.
 */
function closeKeyboardModal() {
  const backdrop = document.getElementById('keyboardModalBackdrop');
  if (backdrop) {
    backdrop.classList.remove('visible');
  }
}

/**
 * selectWorkspaceAll()
 *
 * Checks all checkboxes in the Workspace modal tabs list.
 */
function selectWorkspaceAll() {
  const checkboxes = document.querySelectorAll('.modal-tab-checkbox');
  checkboxes.forEach(cb => cb.checked = true);
}

/**
 * selectWorkspaceNone()
 *
 * Unchecks all checkboxes in the Workspace modal tabs list.
 */
function selectWorkspaceNone() {
  const checkboxes = document.querySelectorAll('.modal-tab-checkbox');
  checkboxes.forEach(cb => cb.checked = false);
}

/**
 * handleWorkspaceSave()
 *
 * Validates form inputs and saves the custom Workspace.
 */
async function handleWorkspaceSave() {
  const nameInput = document.getElementById('workspaceNameInput');
  if (!nameInput) return;

  const name = nameInput.value.trim();
  if (!name) {
    showToast('Please enter a workspace name!');
    nameInput.focus();
    return;
  }

  const checkedBoxes = document.querySelectorAll('.modal-tab-checkbox:checked');
  if (checkedBoxes.length === 0) {
    showToast('Please select at least one tab!');
    return;
  }

  const selectedTabs = Array.from(checkedBoxes).map(cb => {
    // Attempt to locate matching tab in current openTabs to capture its correct title and favicon
    const tabId = parseInt(cb.dataset.tabId, 10);
    const matchingTab = openTabs.find(t => t.id === tabId);
    return {
      title: matchingTab ? matchingTab.title : cb.dataset.url,
      url: cb.dataset.url,
      favIconUrl: matchingTab ? matchingTab.favIconUrl : ''
    };
  });

  await saveWorkspace(name, selectedTabs);
  closeWorkspaceModal();
}

/**
 * saveWorkspace(name, selectedTabs)
 *
 * Saves selected tabs (with title, url, favicon) as a named workspace in local storage.
 */
async function saveWorkspace(name, selectedTabs) {
  if (!selectedTabs || selectedTabs.length === 0) {
    showToast('No tabs selected to save!');
    return;
  }

  const { workspaces = [] } = await chrome.storage.local.get('workspaces');

  // Schema: id, name, createdAt, tabs: [{title, url, favIconUrl}], urls (for backwards compatibility)
  const newWorkspace = {
    id: 'ws-' + Date.now(),
    name: name,
    tabs: selectedTabs,
    urls: selectedTabs.map(t => t.url), // maintain old flat array for fully backward-compatible loading
    createdAt: Date.now()
  };

  workspaces.push(newWorkspace);
  await chrome.storage.local.set({ workspaces });

  playSaveSound();
  showToast(`Saved workspace "${name}" with ${selectedTabs.length} tab${selectedTabs.length !== 1 ? 's' : ''}! 📁`);
  await renderStaticDashboard();
}

/**
 * renderWorkspaces()
 *
 * Populates the Workspaces list in the sidebar with active saved workspaces.
 */
async function renderWorkspaces() {
  const workspacesContainer = document.getElementById('workspacesList');
  const workspacesEmpty = document.getElementById('workspacesEmpty');
  const countEl = document.getElementById('workspacesCount');
  if (!workspacesContainer) return;

  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  if (countEl) countEl.textContent = workspaces.length;

  if (workspaces.length === 0) {
    workspacesContainer.innerHTML = '';
    if (workspacesEmpty) workspacesEmpty.style.display = 'block';
    return;
  }

  if (workspacesEmpty) workspacesEmpty.style.display = 'none';
  workspacesContainer.innerHTML = workspaces.map(ws => {
    const isExpanded = expandedWorkspaceIds.has(ws.id);
    const arrowClass = isExpanded ? 'workspace-toggle-arrow expanded' : 'workspace-toggle-arrow';
    const listClass = isExpanded ? 'workspace-preview-list expanded' : 'workspace-preview-list';

    // Backwards-compatible fallback mapping for workspaces created before rich tab schema metadata
    const tabList = ws.tabs || (ws.urls || []).map(url => {
      let label = url;
      try {
        const parsed = new URL(url);
        label = parsed.hostname.replace(/^www\./, '') + parsed.pathname;
        if (label.length > 35) label = label.substring(0, 35) + '...';
      } catch {}
      return { title: label, url: url, favIconUrl: '' };
    });

    const previewItemsHtml = tabList.map(tab => {
      const displayTitle = escapeHtml(tab.title || tab.url);
      const displayFavicon = tab.favIconUrl || 'icons/icon16.png';
      return `
        <div class="workspace-preview-item" data-action="restore-single-ws-tab" data-url="${escapeHtml(tab.url)}" title="Click to open this specific tab: ${displayTitle}">
          <img class="workspace-preview-favicon" src="${displayFavicon}" onerror="this.src='icons/icon16.png';">
          <span class="workspace-preview-title">${displayTitle}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="workspace-wrapper">
        <div class="workspace-item clickable" data-action="toggle-workspace-fold" data-ws-id="${ws.id}">
          <div class="workspace-header-left">
            <svg class="${arrowClass}" data-ws-id="${ws.id}" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
            <div class="workspace-info">
              <span class="workspace-name">${escapeHtml(ws.name)}</span>
              <span class="workspace-meta">${tabList.length} tabs &nbsp;&middot;&nbsp; ${new Date(ws.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
          <div class="workspace-actions">
            <button class="ws-action ws-restore" data-action="restore-workspace" data-ws-id="${ws.id}" title="Restore Workspace">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
            </button>
            <button class="ws-action ws-delete" data-action="delete-workspace" data-ws-id="${ws.id}" title="Delete Workspace">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.34 9m-4.78 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.108 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
            </button>
          </div>
        </div>
        <div class="workspace-preview-list" data-ws-id="${ws.id}">
          ${previewItemsHtml}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * initThemeSystem()
 *
 * Loads the active theme from chrome.storage.local and applies it to the document element.
 */
async function initThemeSystem() {
  try {
    const { theme = 'sage-green' } = await chrome.storage.local.get('theme');
    applyTheme(theme);
  } catch (err) {
    console.error('[tab-out] initThemeSystem error:', err);
    applyTheme('sage-green'); // fallback
  }
}

/**
 * applyTheme(themeName)
 *
 * Appends or removes theme classes and updates button UI elements.
 */
function applyTheme(themeName) {
  const root = document.documentElement;
  
  const iconMoon = document.querySelector('.theme-icon-moon');
  const iconSun = document.querySelector('.theme-icon-sun');

  if (themeName === 'cyberpunk-blue') {
    root.classList.add('theme-cyberpunk');
    if (iconMoon) iconMoon.style.display = 'none';
    if (iconSun) iconSun.style.display = 'inline-block';
    
    // Also style Save Workspace button to match Cyberpunk Cyan
    const btnSaveWorkspace = document.getElementById('btnSaveWorkspace');
    if (btnSaveWorkspace) {
      btnSaveWorkspace.style.background = 'rgba(0, 240, 255, 0.08)';
      btnSaveWorkspace.style.borderColor = 'rgba(0, 240, 255, 0.15)';
      btnSaveWorkspace.style.color = 'var(--accent-sage)';
    }
  } else {
    root.classList.remove('theme-cyberpunk');
    if (iconMoon) iconMoon.style.display = 'inline-block';
    if (iconSun) iconSun.style.display = 'none';
    
    // Style Save Workspace button back to Sage Green
    const btnSaveWorkspace = document.getElementById('btnSaveWorkspace');
    if (btnSaveWorkspace) {
      btnSaveWorkspace.style.background = 'rgba(90, 122, 98, 0.08)';
      btnSaveWorkspace.style.borderColor = 'rgba(90, 122, 98, 0.15)';
      btnSaveWorkspace.style.color = 'var(--accent-sage)';
    }
  }
}


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
initThemeSystem();
initTechCursor();
initPixelPetSystem();
renderDashboard();


/* ================================================================
   PIXEL TAB PET COMPCompanion SYSTEM Logic
   ================================================================ */

let petBubbleTimeout = null;

/**
 * playPetMeow()
 * Synthesizes Mochi's cute soft "meow" sweep via Web Audio API.
 */
function playPetMeow() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // First pitch chirp
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(750, audioCtx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(1150, audioCtx.currentTime + 0.08);
    
    gain1.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
    
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start();
    osc1.stop(audioCtx.currentTime + 0.12);

    // Soft harmonized delay chirp for purr warmth
    setTimeout(() => {
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1150, audioCtx.currentTime);
      osc2.frequency.exponentialRampToValueAtTime(1250, audioCtx.currentTime + 0.06);
      
      gain2.gain.setValueAtTime(0.05, audioCtx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
      
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.start();
      osc2.stop(audioCtx.currentTime + 0.08);
    }, 40);

  } catch (err) {
    console.error('[tab-out] playPetMeow failed:', err);
  }
}

/**
 * playPetBeep()
 * Synthesizes Byte's retro sci-fi 8-bit FM chime chord.
 */
function playPetBeep() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'square';
    osc1.frequency.setValueAtTime(1046.50, audioCtx.currentTime); // C6
    osc1.frequency.setValueAtTime(1318.51, audioCtx.currentTime + 0.04); // E6
    
    gain1.gain.setValueAtTime(0.04, audioCtx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start();
    osc1.stop(audioCtx.currentTime + 0.1);
  } catch (err) {
    console.error('[tab-out] playPetBeep failed:', err);
  }
}

/**
 * triggerPetVoice()
 * Plays active sound feedback depending on currently active theme.
 */
function triggerPetVoice() {
  const isCyber = document.documentElement.classList.contains('theme-cyberpunk');
  if (isCyber) {
    playPetBeep();
  } else {
    playPetMeow();
  }
}

/**
 * showPetBubble(text, durationMs)
 * Springs up the speech bubble with customized geeky commentary.
 */
function showPetBubble(text, durationMs = 3500) {
  const bubble = document.getElementById('petBubble');
  const bubbleText = document.getElementById('petBubbleText');
  if (!bubble || !bubbleText) return;

  bubbleText.textContent = text;
  bubble.classList.add('visible');

  if (petBubbleTimeout) {
    clearTimeout(petBubbleTimeout);
  }

  petBubbleTimeout = setTimeout(() => {
    bubble.classList.remove('visible');
  }, durationMs);
}

/**
 * triggerPetAnimation(className)
 * Triggers a CSS keyframe micro-interaction state and removes it.
 */
function triggerPetAnimation(className) {
  const wrapper = document.getElementById('petSpriteWrapper');
  if (!wrapper) return;

  wrapper.classList.remove('pet-action-hop', 'pet-action-spin', 'pet-action-shake');
  // Trigger DOM reflow to restart CSS keyframe transitions
  void wrapper.offsetWidth;
  wrapper.classList.add(className);
}

/**
 * updatePetState(tabCount)
 * Recalculates pet mood, wiggles elements, modifies expressions and sets localized quotes.
 */
function updatePetState(tabCount) {
  const root = document.documentElement;
  const isCyber = root.classList.contains('theme-cyberpunk');
  
  const spriteMochi = document.getElementById('spriteMochi');
  const spriteByte = document.getElementById('spriteByte');
  const mochiBlanket = document.getElementById('mochiBlanket');
  const byteExpression = document.getElementById('byteExpression');
  
  if (!spriteMochi || !spriteByte) return;

  // Toggle visible theme-dependent sprite
  if (isCyber) {
    spriteMochi.style.display = 'none';
    spriteByte.style.display = 'flex';
  } else {
    spriteMochi.style.display = 'flex';
    spriteByte.style.display = 'none';
  }

  // Manage expressions and sleeping layers
  if (tabCount === 0) {
    spriteMochi.classList.add('sleeping');
    if (mochiBlanket) mochiBlanket.style.display = 'block';
    if (byteExpression) byteExpression.textContent = '- _ -';
  } else {
    spriteMochi.classList.remove('sleeping');
    if (mochiBlanket) mochiBlanket.style.display = 'none';
    
    if (tabCount <= 10) {
      if (byteExpression) byteExpression.textContent = '^ _ ^';
    } else if (tabCount <= 20) {
      if (byteExpression) byteExpression.textContent = 'o _ o';
    } else {
      if (byteExpression) byteExpression.textContent = '✖ _ ✖';
    }
  }
}

/**
 * getPetContextQuote(tabCount)
 * Returns a randomized funny quote tailored to current layout load.
 */
function getPetContextQuote(tabCount) {
  const isCyber = document.documentElement.classList.contains('theme-cyberpunk');
  
  if (tabCount === 0) {
    const quotes = isCyber
      ? ["Zen core ready.", "System cooling. Zero load.", "All threads clear.", "Standing by..."]
      : ["呼... 暖呼呼喵... 💤", "数码界终归禅静 ✨", "猫饼已摊平...", "好舒服... 🍵"];
    return quotes[Math.floor(Math.random() * quotes.length)];
  }
  
  if (tabCount <= 10) {
    const quotes = isCyber
      ? ["Vibe: Ideal. Speed optimal.", "Threads optimized! 🌿", "Processor breathing easily.", "Ready to deploy."]
      : ["一切井井有条喵！😻", "今天也是利落的一天！", "出来晒太阳啦~ 🌸", "心情极度舒适！"];
    return quotes[Math.floor(Math.random() * quotes.length)];
  }
  
  if (tabCount <= 20) {
    const quotes = isCyber
      ? ["Warning: RAM threshold.", "A bit crowded here...", "Active process buffer full.", "Load rising."]
      : ["事情开始多起来了喵...", "我的小尾巴转不过来了", "你在默默憋什么大招？", "要加油了喵！⏰"];
    return quotes[Math.floor(Math.random() * quotes.length)];
  }
  
  const quotes = isCyber
    ? ["🚨 CRITICAL OVERFLOW!", "SYSTEM STALL RISK!", "RAM BURST. DEPLOY SHIELD!", "ABORT ALL CLUTTER! ✖_✖"]
    : ["救命！被网页淹没了！🙀", "RAM 要炸了喵！！🚨", "Too many tabs... 躲进箱子", "快把不要的冷冻掉喵！❄️"];
  return quotes[Math.floor(Math.random() * quotes.length)];
}

/**
 * pokePet()
 * Poke trigger to play voice, bounce sprite and say localized quotes.
 */
function pokePet() {
  triggerPetVoice();
  
  chrome.tabs.query({}, (tabs) => {
    // Filter out Tab Out itself
    const actualTabs = tabs.filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://'));
    const tabCount = actualTabs.length;
    
    // Choose hop or spin
    const r = Math.random();
    if (r < 0.6) {
      triggerPetAnimation('pet-action-hop');
    } else {
      triggerPetAnimation('pet-action-spin');
    }
    
    // Show randomized interactive comments
    const isCyber = document.documentElement.classList.contains('theme-cyberpunk');
    const pokes = isCyber
      ? ["Interaction acknowledged. ^_^", "Core ping: 5ms", "Synthesizer online. Beep!", "Please don't tickle my antenna!"]
      : ["喵呜~ 蹭蹭！💖", "摸我尾巴会漏电喵！⚡", "咕噜咕噜踩奶中...", "贴贴！(๑•́ ₃ •̀๑)"];
    
    showPetBubble(pokes[Math.floor(Math.random() * pokes.length)]);
  });
}

/**
 * initPixelPetSystem()
 * Sets up listeners and sets initial state.
 */
function initPixelPetSystem() {
  const petContainer = document.getElementById('tabPetContainer');
  if (!petContainer) return;

  // Add click trigger
  petContainer.addEventListener('click', pokePet);

  // Monitor tab count changes directly via background messages or simple checks
  const checkState = () => {
    chrome.tabs.query({}, (tabs) => {
      const actualTabs = tabs.filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://'));
      updatePetState(actualTabs.length);
    });
  };

  // Check state on init
  checkState();

  // Re-check on dynamic click updates or themes
  document.getElementById('btnThemeToggle').addEventListener('click', () => {
    setTimeout(checkState, 150);
  });

  // Greet user shortly on initial load
  setTimeout(() => {
    chrome.tabs.query({}, (tabs) => {
      const actualTabs = tabs.filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://'));
      showPetBubble(getPetContextQuote(actualTabs.length));
    });
  }, 1000);
}


/* ================================================================
   HOOK INTO DASHBOARD OPERATIONS TO EMIT COMPANION EFFECTS
   ================================================================ */

// Hook into single tab deletion
const origCloseTab = window.closeTab; 
// Check if closeTab is global or declared locally. Let's patch standard close and save actions directly.
// To do this reliably, we can listen for clicks inside document for actions or just set intervals.
// Let's hook our custom pet reaction events globally.
function notifyPetAction(actionType) {
  if (actionType === 'close') {
    triggerPetAnimation('pet-action-hop');
    showPetBubble(Math.random() < 0.5 ? "消灭一个！Snappy! 💨" : "啪！垃圾页面退散！🔥");
  } else if (actionType === 'save') {
    triggerPetAnimation('pet-action-spin');
    showPetBubble(Math.random() < 0.5 ? "安全锁存！妥妥哒 💾" : "成功保存至百宝袋！✨");
  } else if (actionType === 'freeze') {
    triggerPetAnimation('pet-action-hop');
    showPetBubble("呼... 瞬间省电 70%! ❄️");
  }
}

// Make notifyPetAction global so other click handlers can invoke it
window.notifyPetAction = notifyPetAction;
