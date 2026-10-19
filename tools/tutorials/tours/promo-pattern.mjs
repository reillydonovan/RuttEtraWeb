// The promo, cut B: the Pattern Generator instead of the sample video (owner A/B).
//   node build.mjs --voice elevenlabs:<id> promo-pattern  → out/promo/promo-pattern.mp4 (+ -music)
export * from './promo.mjs?variant=pattern';
