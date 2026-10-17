## Design Principles

This synth was built with a small number of rules in mind. They're worth knowing because they explain why some things work the way they do — and why a few things deliberately don't work the way you might expect from other tools. The rules came up over and over during the build. Writing them down keeps them honest.

<h3 id="one-concept">One concept, one place to set it.</h3>

When you change the BPM, it changes everywhere at once — function generator LFOs in tempo mode, the Timeline, Graph clock nodes. There aren't three separate BPM fields scattered through the UI. The synth tries to have a single source of truth for any concept you care about, so changing your mind in one place updates everywhere it matters.

<h3 id="modulation-knobs">Modulation doesn't overwrite your knobs.</h3>

When an LFO is wobbling Z Push, the Z Push slider in the UI still shows the value *you* set. The wobble happens on top. Turn the LFO off and Z Push snaps back to where you left it — not to wherever the LFO last had it. Your manual settings are preserved underneath whatever's modulating them.

The same holds in the **hardware and rack skins** (the skin picker in the panel title bar swaps the flat CRT controls for rotary knobs, bat switches, and — in RACK — live patch cables): the knob's pointer is *your* setting, and turning it edits exactly what the flat slider would. Dragging a patch cable edits the same slot Target the Modulation panel's dropdown does — cables are a picture of your patch, not a separate system. The skin choice itself is remembered on your machine, not in your patches — loading someone else's project never restyles your panel.

<h3 id="tells-you-whats-wrong">The synth tells you what's wrong, instead of hiding it.</h3>

If MIDI Clock is selected and no MIDI clock is reaching the synth, an LFO won't quietly run at internal tempo — it'll show a *no clock* indicator. If a configured device disconnects, you'll see it. Silent fallbacks make problems invisible; the synth prefers to show you what's actually happening so you can fix it.

<h3 id="no-accident-sound">The synth doesn't make sound by accident.</h3>

Anything that produces audio — sonification, voltage going to a hardware modular — starts disabled, defaults to quiet (around −18 dB), and ramps up gently when you enable it. Loading a project restores audio configurations but doesn't auto-enable them. Audio output is where unhappy accidents happen, so the synth is deliberately conservative.

<h3 id="two-ways">Two ways to do something is sometimes correct.</h3>

You can modulate with the simple 4-slot matrix, or with the full node graph, or both at once. Presets save a look; Projects save your whole workspace. Pattern Generator is a layer that combines with your webcam, not a fourth source type that excludes it. The right shape depends on what you're doing, so the synth offers both rather than picking for you.

<h3 id="saved-work-preserved">Saved work is preserved, even when it changes.</h3>

When you shorten a timeline, keyframes past the new end aren't deleted — they're flagged so you can see them but they don't play. When old preset formats load into a newer build, they're upgraded explicitly with a note about what changed. The synth doesn't quietly throw your work away to keep the data clean.

<h3 id="matches-how-you-think">The structure matches how you think about it, not how it's built.</h3>

Patterns are layers because that's how compositing makes sense. Preset keyframes and automation lanes are separate concepts because "set the overall structure" and "animate one knob" are different jobs. The Function Generators and Graph modulation coexist because they're genuinely different mental models. The synth tries to bend its data toward how you reason, not toward what's convenient to code.

<h3 id="manual-with-feature">Every feature comes with the manual entry.</h3>

This page, the in-app Help panel, the keyboard shortcut reference — they're written as part of every feature, not as an afterthought. Auto-generated parts — every modulation source, every graph node — are wired so the docs can't drift from the actual code. If a feature exists, it's documented.

<h3 id="small-versions">Small versions that work, not big versions that almost work.</h3>

Sonification has one voice, not a polyphonic synth — because one voice that sounds good is more useful than thirty-two voices that don't quite. Features ship in stages: visual rendering before signal exposure, beginner views before advanced ones, the simple cases before the elaborate ones. The result is a synth where things you reach for actually work.

---

If something in this synth feels surprising or different from another tool you've used, the principles above are usually why. They're not arbitrary, and they're not soft preferences — they're choices that came up over and over during the build, each one decided deliberately. Knowing them makes the rest of the manual easier to read, and the synth itself easier to predict.
