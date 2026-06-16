# Profile Customization with Micro-interactions

Detailed functional design and technical spec for the 100% offline, highly tactile personal profile module integrated into the header of **Tab Out**.

---

## 1. Visual & Structural Design

### 1.1 Header Left Layout (`index.html`)
The existing `.header-left` elements will be grouped and enhanced with an avatar icon trigger on the left of the greeting text.

```html
<div class="header-left">
  <div class="profile-trigger" id="profileTrigger" title="Edit Profile & Avatar">
    <div class="profile-avatar-container">
      <span class="profile-avatar-emoji" id="profileAvatarEmoji">🐱</span>
      <div class="profile-edit-badge">✏️</div>
    </div>
  </div>
  <div class="header-text">
    <h1 id="greeting"></h1>
    <div class="date" id="dateDisplay"></div>
  </div>
</div>
```

### 1.2 Interactive Profile Popover (`index.html`)
An elegant, floating speech-bubble style popover that appears right below the profile trigger with smooth scale animations.

```html
<div class="profile-popover" id="profilePopover">
  <div class="popover-arrow"></div>
  <div class="profile-popover-header">Customize Profile</div>
  <div class="profile-popover-body">
    <div class="input-group">
      <label for="profileNameInput">Your Name</label>
      <input type="text" id="profileNameInput" placeholder="Adventurer..." maxlength="15" autocomplete="off">
    </div>
    <div class="avatar-grid-label">Choose Avatar</div>
    <div class="avatar-grid" id="profileAvatarGrid">
      <!-- 8 unique high-fidelity pixel style emoji avatars -->
      <span class="avatar-grid-item" data-emoji="🐱">🐱</span>
      <span class="avatar-grid-item" data-emoji="🤖">🤖</span>
      <span class="avatar-grid-item" data-emoji="👾">👾</span>
      <span class="avatar-grid-item" data-emoji="☕">☕</span>
      <span class="avatar-grid-item" data-emoji="🦊">🦊</span>
      <span class="avatar-grid-item" data-emoji="🐼">🐼</span>
      <span class="avatar-grid-item" data-emoji="🚀">🚀</span>
      <span class="avatar-grid-item" data-emoji="🎮">🎮</span>
    </div>
  </div>
  <div class="profile-popover-footer">
    <button class="tactile-btn secondary" id="btnProfileCancel" style="padding: 4px 10px; font-size: 11px;">Cancel</button>
    <button class="tactile-btn" id="btnProfileSave" style="padding: 4px 12px; font-size: 11px;">Save Profile</button>
  </div>
</div>
```

---

## 2. Styling & Micro-interactions (`style.css`)

### 2.1 Profile Trigger & Animation
- **Profile Trigger**: A 52px circular flex container featuring subtle drop shadows, smooth border highlights, and hover squash-and-stretch.
- **Cyberpunk Adaptations**: Uses neon-cyan cyber shadows, monospace text styles, and matrix border parameters when `.theme-cyberpunk` is enabled.
- **Animations**:
  - `profile-popover-in` keyframes: `transform: scale(0.9) translateY(-10px)` to `scale(1) translateY(0)` with a physical elastic spring curve.
  - Active hover animations on the edit badge and individual avatar grid selections.

---

## 3. Dynamic Logic & Audio Feedback (`app.js`)

### 3.1 Profile State & Storage
- Loaded from `chrome.storage.local.get(['profileName', 'profileEmoji'])`.
- Fallbacks: Name defaults to `"Adventurer"`, Emoji defaults to `"🐱"`.
- Greeting update: Re-writes greeting message dynamically using `getGreeting() + ", " + profileName + "!"`.

### 3.2 Sound Synthesis
- Saves trigger a cute and satisfying 8-bit scale synthesizer sweep (increasing arpeggio with high-pass filtering).

### 3.3 Confetti Physical Burst & Companion Interactions
- Emits standard confetti particles precisely centered on the newly updated avatar trigger.
- Companion reaction: Calls `window.notifyPetAction('profile')` to let Mochi or Byte greet the user by their custom name with specialized dialogue!
