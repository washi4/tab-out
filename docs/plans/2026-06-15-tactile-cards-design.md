# Design: Tactile Cards and Smooth Micro-interactions

This document outlines the design and implementation details for the "Classic Springy & Smooth" micro-interactions in Tab Out.

## Purpose
Enhance the physical feel and responsiveness of the Tab Out dashboard. By adding natural elastic spring effects, active press-down feedback, directional dismissal animations, and smooth accordion transitions, the extension becomes noticeably more satisfying and fun to use while maintaining its clean, minimalist aesthetic.

## Changes & Component Architecture

### 1. Springy Elevation on Card Hover
- **Selector**: `.mission-card`
- **Interaction**: Lift slightly (`translateY(-4px)`) and cast a softer, deeper shadow when hovered to create depth.
- **Transition**: Smooth custom cubic-bezier timing function (`cubic-bezier(0.25, 0.8, 0.25, 1)`) for card transformations.
- **Feedback**: A snappy `:active` press-down state (`translateY(-1px) scale(0.985)`) on click, giving immediate physical response.

### 2. Elastic Sliding on Tab Hover and Directional Dismissal
- **Selector**: `.page-chip.clickable`
- **Hover**: Shift slightly to the right (`translateX(4px)`) to visually indicate selectability and mouse focus.
- **Save Dismissal (`defer-single-tab`)**: Animate single-tab rows sliding right (`translateX(30px)`) and scaling down into the Saved for Later sidebar when saved.
- **Close Dismissal (`close-single-tab`)**: Animate single-tab rows sliding left (`translateX(-30px)`) and scaling down to indicate discarded/trashed status.

### 3. Archive Accordion Expansion
- **Selector**: `.archive-body`
- **Transition**: Replace sudden `display: none` toggle with a CSS transition on `max-height`, `opacity`, and `padding`. Toggled smoothly via the `.open` class.

### 4. Combo Streak Fire Effects (Scheme B)
- **Concept**: Track rapid successive tab closures within 2.5 seconds.
- **Visuals**: A floating badge (`.combo-badge`) slide-spawns at the bottom right.
- **Tiers**:
  * Tier 1 (2-4x): Subtle ink & paper badge with standard lightning icon.
  * Tier 2 (5-9x): Golden-amber gradient fire badge (`🔥`).
  * Tier 3 (10x+): Blazing rose gradient badge with firestorms (`🔥💥🔥`), subtle continuous shadow breathing, and milestone confetti blasts.

### 5. Zen Mode Quotes & Breathing Empty State (Scheme C)
- **Concept**: Turn the empty state into a relaxing moment of tranquility.
- **Zen Quotes**: Randomly select from 7 cozy, encouraging quotes (e.g. *"Ah, digital peace and quiet. Time to make a warm cup of tea 🍵"*).
- **Breathing Pulse**: `.empty-checkmark` has a slow, rhythmic 3-second breathing pulse scale transition on its soft sage outer glow.

### 6. Sound Synthesizers Upgrade (Scheme A)
- **Bubble Plop (`playSaveSound`)**: A rapidly rising sine frequency sweep from 300Hz to 1200Hz over 0.15s, making a perfect organic "plop/bubble" sound when saving a tab.
- **Achievement Chime (`playChimeSound`)**: An arpeggiated major chord bell chime (C5, E5, G5, C6) with natural bell decay when checking off list items.

## Verification & Testing
- Open a new tab in Chrome/Edge.
- Hover over domain cards and click to verify springiness and click compression.
- Hover over tab list items to verify sliding.
- Close a tab and watch it slide left with sound/confetti.
- Save a tab for later: listen to the bubbly plop sound and watch it slide right into the checklist.
- Check off a checklist item: listen to the harmonious arpeggiated major chime.
- Close multiple tabs rapidly to watch the combo counter scale up and shift colors.
- Clear all tabs to trigger the Zen Mode empty state, verifying the breathing glow and random comfort quotes.
- Toggle the archive to verify accordion expansion.
