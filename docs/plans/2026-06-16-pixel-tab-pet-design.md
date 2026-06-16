# Design: Pixel Tab Pet — Multi-State Responsive Companion

This document outlines the design and implementation details for adding an adaptive, multi-state digital companion (the Pixel Tab Pet) to Tab Out.

## Purpose
Introduce a physical, responsive, and playful element to the dashboard that provides immediate visual and audio feedback, giving users an emotional connection to their tab-cleaning actions. By mapping the pet's behavior to the open tab count and user micro-interactions, we turn clean-up chores into a satisfying digital game.

## Components & Visual Architecture

### 1. The Container (`.tab-pet-container`)
- **Placement**: Fixed to the bottom-right corner of the window (`position: fixed; bottom: 24px; right: 24px; z-index: 5000;`).
- **Platform Base (`.pet-platform`)**: An elegant squircle platform.
  - **Sage Theme**: A soft warm-gray/ceramic circular dish with subtle shadow and light-sage ambient glow.
  - **Cyberpunk Theme**: A neon cyan holographic plate with sharp borders and continuous particle floating animations.
- **The Sprite (`.pet-sprite`)**: Hand-crafted CSS layered shapes forming:
  - **Sage Green**: A cute, chubby cat named **"Mochi"** that blinks, wiggles its tail, and rolls around.
  - **Cyberpunk**: A floating holographic helper orb named **"Byte"** that hovers up and down with sine waves, displaying retro neon digital facial expressions.
- **The Bubble (`.pet-bubble`)**: A cute message box hovering above the pet's head. It uses spring scaling and is fully localized with playful geeky quotes based on context.

### 2. State Machine & Tab Counts
The pet's mood scales based on the current open tabs count:
- **Zen Mode (0 Tabs)**:
  - *Mochi*: Curled up in a tiny ball asleep with a pixels blankie and small floating `Zzz...` particles.
  - *Byte*: Eyes closed in deep power-saver sleep mode, hovering slowly.
  - *Quote*: "Digital peace. Time for tea 🍵" / "System standby."
- **Healthy Vibe (1-10 Tabs)**:
  - *Mochi*: Purring, tail wagging, cozy stretching.
  - *Byte*: Displaying a happy neon face `^ _ ^`.
  - *Quote*: "Looking very tidy! 🌿" / "Cores optimized. Vibe: Ideal."
- **Busy Day (11-20 Tabs)**:
  - *Mochi*: Ears twitching, tail flicking.
  - *Byte*: Blinking alert light, curious expression `o_o`.
  - *Quote*: "Getting a bit crowded here..." / "RAM indices rising. Monitoring."
- **Overload Alert (> 20 Tabs)**:
  - *Mochi*: Squeezing inside a small cardboard box labeled "TOO MANY TABS" with a sweatdrop particle.
  - *Byte*: Shaking rapidly, showing errored red face `✖_✖`.
  - *Quote*: "SAVE ME! Wading through tabs! 🙀" / "OVERFLOW IN PROGRESS!"

### 3. Immediate Micro-interaction Triggers
When users perform dashboard operations, the pet reacts:
- **Click Pet (Poke)**: Triggers an elastic squish animation (`scale(1.25, 0.7) -> scale(0.85, 1.2) -> scale(1, 1)`) and synthesizes a cute voice chirp.
- **Close Tab**: Pet hops vertically, popping a clean-up bubble: "Poof! Tab deleted! 💨"
- **Save Workspace**: Triggers a glowing pulse around the platform base: "Safely tucked away! 💾"
- **Clean Duplicates**: Pet spins 360 degrees and fires a miniature star confetti ring.

### 4. Audio Voice Synthesis (Web Audio API)
- **Mochi Meow**: Exponentially rising sweep triangle wave (`800Hz` to `1200Hz` in `0.1s`), making a soft, adorable synthesized meow.
- **Byte Beep**: Instant FM synth chord (`C6` to `E6` in `0.08s`) producing a crisp retro 8-bit game ping.

---

## Ready to set up for implementation?
I will begin drafting the implementation plan now.
