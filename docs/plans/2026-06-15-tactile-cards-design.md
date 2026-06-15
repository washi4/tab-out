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

## Verification & Testing
- Open a new tab in Chrome/Edge.
- Hover over domain cards and click to verify springiness and click compression.
- Hover over tab list items to verify sliding.
- Close a tab and watch it slide left with sound/confetti.
- Save a tab for later and watch it slide right into the checklist.
- Toggle the archive to verify accordion expansion.
