/**
 * popup.js — Tab Out Quick Search Logic
 * Supports zero-lag theme sync, domain grouping, fuzzy filtering,
 * full keyboard navigation, tab switching, and Web Audio synth sound feedback.
 */

// ─── Theme Synchronization ───────────────────────────────────────────────────
async function initTheme() {
  try {
    const { theme = 'sage-green' } = await chrome.storage.local.get('theme');
    if (theme === 'cyberpunk-blue') {
      document.body.classList.add('theme-cyberpunk');
      document.documentElement.classList.add('theme-cyberpunk');
    } else {
      document.body.classList.remove('theme-cyberpunk');
      document.documentElement.classList.remove('theme-cyberpunk');
    }
  } catch (err) {
    console.error('[tab-out] Failed to init theme:', err);
  }
}

// ─── Web Audio Feedback Synth ───────────────────────────────────────────────
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume context if suspended
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playCloseSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    // Smooth high-frequency down-sweep for a satisfying physical tick/chirp
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.15);
    
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(now);
    osc.stop(now + 0.16);
  } catch (err) {
    console.error('Audio play error:', err);
  }
}

// ─── Tab Management & Rendering ──────────────────────────────────────────────
let allTabs = [];
let selectedIdx = 0;
let tabElements = [];

// Helper to extract clean domain/port from URL
function getDomainAndPort(urlStr) {
  try {
    if (!urlStr || urlStr.startsWith('about:')) return 'System Pages';
    const url = new URL(urlStr);
    
    // Group browser internal pages
    if (url.protocol.startsWith('chrome') || url.protocol.startsWith('edge')) {
      return 'System Pages';
    }
    
    let domain = url.hostname.replace(/^www\./, '');
    if (url.port) {
      domain += `:${url.port}`;
    }
    return domain;
  } catch {
    return 'Other';
  }
}

// Query all tabs from Chrome
async function loadTabs() {
  try {
    allTabs = await chrome.tabs.query({});
    renderList();
  } catch (err) {
    console.error('[tab-out] Failed to load tabs:', err);
  }
}

// Render the search list (grouped when empty, flat when searching)
function renderList() {
  const query = document.getElementById('search-input').value.trim().toLowerCase();
  const tabsList = document.getElementById('tabs-list');
  tabsList.innerHTML = '';
  
  if (!query) {
    // 1. Grouped State: Group by Domain and Port
    const groups = {};
    allTabs.forEach(tab => {
      const domain = getDomainAndPort(tab.url);
      if (!groups[domain]) groups[domain] = [];
      groups[domain].push(tab);
    });
    
    // Sort domains: system pages and other always at the bottom, rest sorted by tab count descending
    const sortedDomains = Object.keys(groups).sort((a, b) => {
      if (a === 'System Pages') return 1;
      if (b === 'System Pages') return -1;
      if (a === 'Other') return 1;
      if (b === 'Other') return -1;
      return groups[b].length - groups[a].length || a.localeCompare(b);
    });
    
    sortedDomains.forEach(domain => {
      // Domain header
      const firstTab = groups[domain][0];
      const faviconUrl = firstTab.favIconUrl || `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
      
      const headerDiv = document.createElement('div');
      headerDiv.className = 'domain-group-header';
      headerDiv.innerHTML = `
        <div class="domain-group-left">
          <img class="domain-group-icon" src="${faviconUrl}" onerror="this.style.display='none';">
          <span>${domain}</span>
          <span class="domain-group-count">${groups[domain].length}</span>
        </div>
        ${domain !== 'System Pages' ? `<div class="domain-group-close" title="Close all tabs in this domain">Close all</div>` : ''}
      `;
      
      const closeBtn = headerDiv.querySelector('.domain-group-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeDomain(domain, groups[domain]);
        });
      }
      
      tabsList.appendChild(headerDiv);
      
      // Tabs within this domain
      groups[domain].forEach(tab => {
        tabsList.appendChild(createTabItemElement(tab));
      });
    });
  } else {
    // 2. Search State: Flattened & Fuzzy filter list
    const matches = allTabs.filter(tab => {
      const title = (tab.title || '').toLowerCase();
      const url = (tab.url || '').toLowerCase();
      return title.includes(query) || url.includes(query);
    });
    
    // Sort matches: Matches in title appear first
    matches.sort((a, b) => {
      const aTitleMatch = (a.title || '').toLowerCase().includes(query);
      const bTitleMatch = (b.title || '').toLowerCase().includes(query);
      if (aTitleMatch && !bTitleMatch) return -1;
      if (!aTitleMatch && bTitleMatch) return 1;
      return 0;
    });
    
    if (matches.length === 0) {
      const noResults = document.createElement('div');
      noResults.className = 'no-results';
      noResults.textContent = 'No matching tabs found... 💤';
      tabsList.appendChild(noResults);
    } else {
      matches.forEach(tab => {
        tabsList.appendChild(createTabItemElement(tab, true));
      });
    }
  }
  
  // Cache rendered tab elements & reset selection
  tabElements = Array.from(document.querySelectorAll('.tab-item'));
  selectedIdx = 0;
  updateSelection();
}

// Create individual interactive tab DOM element
function createTabItemElement(tab, showDomain = false) {
  const domain = getDomainAndPort(tab.url);
  const faviconUrl = tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  
  const tabDiv = document.createElement('div');
  tabDiv.className = 'tab-item';
  tabDiv.dataset.id = tab.id;
  tabDiv.dataset.windowId = tab.windowId;
  
  tabDiv.innerHTML = `
    <img class="tab-item-favicon" src="${faviconUrl}" onerror="this.src='icons/icon16.png';">
    <div class="tab-item-info">
      <div class="tab-item-title">${escapeHtml(tab.title || 'Untitled Tab')}</div>
      <div class="tab-item-url">${escapeHtml(showDomain ? domain : tab.url || '')}</div>
    </div>
    <div class="tab-item-close" title="Close tab">×</div>
  `;
  
  // Click to jump to tab
  tabDiv.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-item-close')) {
      e.stopPropagation();
      closeTab(tab.id);
    } else {
      focusTab(tab.id, tab.windowId);
    }
  });
  
  // Mouse hover updates index selection for unified navigation feel
  tabDiv.addEventListener('mouseenter', () => {
    const idx = tabElements.indexOf(tabDiv);
    if (idx !== -1) {
      selectedIdx = idx;
      updateSelection(false); // don't auto scroll on mouse hover
    }
  });
  
  return tabDiv;
}

// Focus selected tab and close popup
async function focusTab(tabId, windowId) {
  try {
    await chrome.tabs.update(Number(tabId), { active: true });
    await chrome.windows.update(Number(windowId), { focused: true });
    window.close(); // Close extension popup instantly
  } catch (err) {
    console.error('[tab-out] Failed to switch tab:', err);
  }
}

// Close a tab directly from the popup list
async function closeTab(tabId) {
  try {
    // Play synthesis feedback sound instantly
    playCloseSound();
    
    // Close tab in browser
    await chrome.tabs.remove(Number(tabId));
    
    // Sync local array without reloading all tabs to preserve UI scroll/state
    allTabs = allTabs.filter(t => t.id !== tabId);
    
    // Remember current select index state
    const currentSelectedId = tabElements[selectedIdx]?.dataset.id;
    
    renderList();
    
    // Try to re-select previous selected element (or fallback gracefully)
    const newIdx = tabElements.findIndex(el => el.dataset.id === currentSelectedId);
    if (newIdx !== -1) {
      selectedIdx = newIdx;
    } else {
      selectedIdx = Math.min(selectedIdx, tabElements.length - 1);
    }
    updateSelection();
  } catch (err) {
    console.error('[tab-out] Failed to close tab:', err);
  }
}

// Close all tabs of a domain directly from the popup
async function closeDomain(domainName, tabGroup) {
  try {
    // Play synthesis feedback sound
    playCloseSound();
    
    // Extract tab IDs from group
    const tabIds = tabGroup.map(t => t.id);
    
    // Close in browser
    await chrome.tabs.remove(tabIds);
    
    // Sync local array
    allTabs = allTabs.filter(t => !tabIds.includes(t.id));
    
    // Re-render
    renderList();
  } catch (err) {
    console.error('[tab-out] Failed to close domain:', err);
  }
}

// Update highlighting class states and scroll target into view
function updateSelection(shouldScroll = true) {
  tabElements.forEach((el, index) => {
    if (index === selectedIdx) {
      el.classList.add('selected');
      if (shouldScroll) {
        el.scrollIntoView({ block: 'nearest' });
      }
    } else {
      el.classList.remove('selected');
    }
  });
}

// ─── Keyboard Orchestrator ───────────────────────────────────────────────────
function initKeyboard() {
  const searchInput = document.getElementById('search-input');
  
  window.addEventListener('keydown', (e) => {
    // 1. Esc to exit popup
    if (e.key === 'Escape') {
      window.close();
      return;
    }
    
    if (tabElements.length === 0) return;
    
    // 2. Arrow Down, Tab or Ctrl+j to navigate down
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey) || (e.ctrlKey && e.key === 'j')) {
      e.preventDefault();
      getAudioContext(); // Warm up audio context on keypresses
      selectedIdx = (selectedIdx + 1) % tabElements.length;
      updateSelection();
      return;
    }
    
    // 3. Arrow Up, Shift+Tab or Ctrl+k to navigate up
    if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      getAudioContext(); // Warm up audio context on keypresses
      selectedIdx = (selectedIdx - 1 + tabElements.length) % tabElements.length;
      updateSelection();
      return;
    }
    
    // 4. Enter to focus current tab
    if (e.key === 'Enter') {
      e.preventDefault();
      const selectedEl = tabElements[selectedIdx];
      if (selectedEl) {
        focusTab(selectedEl.dataset.id, selectedEl.dataset.windowId);
      }
    }
  });
}

// HTML Escaper for security
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Entry Point Initialization ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Sync light/dark style theme
  await initTheme();
  
  // Load and group open tabs
  await loadTabs();
  
  // Set up search inputs listeners
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', () => {
    renderList();
  });
  
  // Focus search box instantly on open
  searchInput.focus();
  
  // Set up keyboard maestro
  initKeyboard();
  
  // Warm up audio context on first click inside window
  document.addEventListener('click', () => {
    getAudioContext();
  });
});
