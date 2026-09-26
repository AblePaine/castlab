// Node test suite for assets/castlab.js. Run: npm test  (node --test tests/*.test.js)
// Expected values are worked by hand in the comments, not copied from the code.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/castlab.js');

const close = (actual, expected, tol = 1e-9, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} expected ${expected}, got ${actual}`);

// ---------------------------------------------------------------------------
test('unit constants are the exact definitions', () => {
  close(C.ML_PER_IN3, 16.387064);
  close(C.ML_PER_US_GAL, 3785.411784, 1e-9);
  close(C.ML_PER_US_QT, 946.352946, 1e-9);
  close(C.ML_PER_US_FLOZ, 29.5735295625, 1e-12);
  close(C.lengthToCm(1, 'in'), 2.54);
  close(C.lengthToCm(1, 'ft'), 30.48);
  close(C.volumeToMl(1, 'L'), 1000);
  assert.throws(() => C.lengthToCm(1, 'yd'), RangeError);
});

// ---------------------------------------------------------------------------
// 1. Mix ratio
test('mix: 1:1 by volume, total 500 mL → 250 + 250 mL; grams from SG', () => {
  const r = C.mixRatio({ resinParts: 1, hardenerParts: 1, basis: 'volume', known: { part: 'total', amount: 500, unit: 'mL' } });
  close(r.resin.mL, 250);
  close(r.hardener.mL, 250);
  close(r.resin.g, 287.5);      // 250 × 1.15
  close(r.hardener.g, 237.5);   // 250 × 0.95
  close(r.total.g, 525);
  close(r.mixedDensity, 1.05);  // 525 / 500
  close(r.weightRatio, 1.15 / 0.95); // 1:1 by volume is 1.2105:1 by weight
});

test('mix: 2:1 by weight, total 300 g → 200 g + 100 g', () => {
  const r = C.mixRatio({ resinParts: 2, hardenerParts: 1, basis: 'weight', known: { part: 'total', amount: 300, unit: 'g' } });
  close(r.resin.g, 200);
  close(r.hardener.g, 100);
  close(r.resin.mL, 200 / 1.15);
  close(r.hardener.mL, 100 / 0.95);
  close(r.volumeRatio, (2 / 1.15) / (1 / 0.95)); // ≈ 1.652:1 by volume
});

test('mix: known one side — 3:1 by volume, 90 mL resin → 30 mL hardener', () => {
  const r = C.mixRatio({ resinParts: 3, hardenerParts: 1, basis: 'volume', known: { part: 'resin', amount: 90, unit: 'mL' } });
  close(r.hardener.mL, 30);
  close(r.total.mL, 120);
});

test('mix: known hardener grams on a volume ratio crosses bases correctly', () => {
  // 2:1 by volume, 95 g hardener → hardener 100 mL → resin 200 mL → 230 g
  const r = C.mixRatio({ resinParts: 2, hardenerParts: 1, basis: 'volume', known: { part: 'hardener', amount: 95, unit: 'g' } });
  close(r.hardener.mL, 100);
  close(r.resin.mL, 200);
  close(r.resin.g, 230);
});

test('mix: custom SGs and custom ratio 100:45 by weight', () => {
  const r = C.mixRatio({ resinParts: 100, hardenerParts: 45, basis: 'weight', sgResin: 1.1, sgHardener: 1.0, known: { part: 'total', amount: 145, unit: 'g' } });
  close(r.resin.g, 100);
  close(r.hardener.g, 45);
  close(r.total.mL, 100 / 1.1 + 45);
});

test('mix: round trip — converting weight ratio to volume ratio and back is identity', () => {
  const byVol = C.mixRatio({ resinParts: 2, hardenerParts: 1, basis: 'volume', known: { part: 'total', amount: 1000, unit: 'g' } });
  const byWt = C.mixRatio({ resinParts: byVol.weightRatio, hardenerParts: 1, basis: 'weight', known: { part: 'total', amount: 1000, unit: 'g' } });
  close(byWt.resin.mL, byVol.resin.mL, 1e-9);
  close(byWt.volumeRatio, 2, 1e-12);
});

test('mix: rejects bad input', () => {
  const base = { resinParts: 1, hardenerParts: 1, known: { part: 'total', amount: 100, unit: 'g' } };
  assert.throws(() => C.mixRatio({ ...base, resinParts: 0 }), RangeError);
  assert.throws(() => C.mixRatio({ ...base, sgResin: -1 }), RangeError);
  assert.throws(() => C.mixRatio({ ...base, known: { part: 'total', amount: 0, unit: 'g' } }), RangeError);
  assert.throws(() => C.mixRatio({ ...base, basis: 'mass' }), RangeError);
});

// ---------------------------------------------------------------------------
// 2. Pour volume
test('pour: rectangle 30 × 20 × 2 cm = 1200 mL', () => {
  const r = C.rectangleVolume({ length: 30, width: 20, depth: 2, unit: 'cm' });
  close(r.exact.mL, 1200);
  close(r.exact.L, 1.2);
  close(r.exact.flOz, 1200 / 29.5735295625);
  close(r.areaCm2, 600);
});

test('pour: rectangle in inches — 10 × 10 × 1 in = 100 in³ = 1638.7064 mL', () => {
  const r = C.rectangleVolume({ length: 10, width: 10, depth: 1, unit: 'in' });
  close(r.exact.mL, 1638.7064, 1e-9);
});

test('pour: cylinder d 10 cm × 5 cm = π·25·5 mL', () => {
  const r = C.cylinderVolume({ diameter: 100, depth: 50, unit: 'mm' });
  close(r.exact.mL, Math.PI * 25 * 5, 1e-9);
});

test('pour: margin and displacement', () => {
  const r = C.rectangleVolume({ length: 10, width: 10, depth: 10, unit: 'cm', displacementMl: 200, marginPct: 10 });
  close(r.grossMl, 1000);
  close(r.exact.mL, 800);
  close(r.planned.mL, 880);
  assert.throws(() => C.rectangleVolume({ length: 1, width: 1, depth: 1, displacementMl: 1 }), RangeError);
});

test('pour: river table from averaged gap measurements', () => {
  // gaps 8, 10, 12 cm → mean 10; 200 cm long, 5 cm deep → 10000 mL
  const r = C.riverTableVolume({ length: 200, depth: 5, unit: 'cm', gapWidths: [8, 10, 12] });
  close(r.meanGapCm, 10);
  close(r.exact.mL, 10000);
  assert.equal(r.method, 'gap');
});

test('pour: river table by wood displacement equals mold minus slabs', () => {
  // mold 90 cm wide, slabs 38 + 42 cm → gap 10 cm; 200 × 5 → 10000 mL
  const r = C.riverTableVolume({ length: 200, depth: 5, unit: 'cm', moldWidth: 90, slabWidths: [38, 42] });
  close(r.exact.mL, 10000);
  const mold = C.rectangleVolume({ length: 200, width: 90, depth: 5 }).exact.mL;
  close(r.exact.mL, mold - (38 + 42) * 200 * 5);
  assert.throws(() => C.riverTableVolume({ length: 200, depth: 5, moldWidth: 80, slabWidths: [40, 40] }), RangeError);
});

// ---------------------------------------------------------------------------
// 3. Deep-pour planner
test('deep pour: tabletop 12 mm → exactly 2 layers of 6 mm (no float off-by-one)', () => {
  const r = C.deepPour({ productType: 'tabletop', totalDepthMm: 12 });
  assert.equal(r.refused, false);
  assert.equal(r.layers, 2);
  close(r.layerDepthMm, 6);
});

test('deep pour: equal layers — 20 mm tabletop → 4 × 5 mm', () => {
  const r = C.deepPour({ productType: 'tabletop', totalDepthMm: 20 });
  assert.equal(r.layers, 4);
  close(r.layerDepthMm, 5);
});

test('deep pour: 0.1 + 0.2 style float noise does not add a layer', () => {
  const r = C.deepPour({ productType: 'tabletop', totalDepthMm: 0.1 + 0.2 + 5.7, maxLayerMm: 6 });
  assert.equal(r.layers, 1);
  assert.equal(r.refused, false);
});

test('deep pour: refuses a forced single layer beyond the product max', () => {
  const r = C.deepPour({ productType: 'deepPour', totalDepthMm: 75, layers: 1 });
  assert.equal(r.refused, true);
  assert.equal(r.minLayers, 2);
  assert.match(r.reason, /exceeds the 50 mm maximum/);
});

test('deep pour: refuses tabletop poured at 10 mm in one go', () => {
  const r = C.deepPour({ productType: 'tabletop', totalDepthMm: 10, layers: 1 });
  assert.equal(r.refused, true);
});

test('deep pour: layer volume, >1 L exotherm warning, schedule', () => {
  // river gap 10 cm × 200 cm = 2000 cm²; 50 mm deep-pour, 100 mm total → 2 × 50 mm
  // layer = 2000 × 50 / 10 = 10000 mL
  const r = C.deepPour({ productType: 'deepPour', totalDepthMm: 100, areaCm2: 2000, recoatHours: 36 });
  assert.equal(r.layers, 2);
  close(r.layerMl, 10000);
  close(r.totalMl, 20000);
  assert.ok(r.warnings.some((w) => /over 1 L/.test(w)));
  assert.deepEqual(r.schedule.map((s) => s.startHour), [0, 36]);
  assert.equal(r.lastPourStartHour, 36);
});

test('deep pour: no exotherm warning at exactly 1 L, warning just above', () => {
  const at = C.deepPour({ productType: 'tabletop', totalDepthMm: 5, areaCm2: 2000 }); // 2000 × 5 / 10 = 1000 mL
  close(at.layerMl, 1000);
  assert.equal(at.warnings.length, 0);
  const over = C.deepPour({ productType: 'tabletop', totalDepthMm: 5, areaCm2: 2001 });
  assert.equal(over.warnings.length, 1);
});

test('deep pour: raising max above default is allowed but flagged', () => {
  const r = C.deepPour({ productType: 'tabletop', totalDepthMm: 10, maxLayerMm: 10 });
  assert.equal(r.layers, 1);
  assert.ok(r.warnings.some((w) => /raised above/.test(w)));
});

test('deep pour: inch round-trip of the preset is not flagged as raised', () => {
  const r = C.deepPour({ productType: 'deepPour', totalDepthMm: 80, maxLayerMm: 1.969 * 25.4 });
  assert.equal(r.warnings.length, 0);
});

test('deep pour: rejects fractional layer counts and non-positive depth', () => {
  assert.throws(() => C.deepPour({ totalDepthMm: 10, layers: 2.5 }), RangeError);
  assert.throws(() => C.deepPour({ totalDepthMm: 0 }), RangeError);
});

// ---------------------------------------------------------------------------
// 4. Pigment
test('pigment: default 3 % of 500 g mix = 15 g', () => {
  const r = C.pigment({ mixGrams: 500 });
  close(r.grams, 15);
  close(r.pctOfFinal, 100 * 15 / 515);
  assert.equal(r.warnings.length, 0);
});

test('pigment: "final" basis solves g/(M+g) = p', () => {
  const r = C.pigment({ mixGrams: 485, pct: 3, basis: 'final' });
  close(r.grams, 15); // 0.03 × 485 / 0.97 = 15
  close(r.pctOfFinal, 3);
});

test('pigment: over 5 % triggers the hard-cap warning', () => {
  const r = C.pigment({ mixGrams: 100, pct: 6 });
  assert.ok(r.warnings.some((w) => /weakens the cure/.test(w)));
  const ok = C.pigment({ mixGrams: 100, pct: 5 });
  assert.equal(ok.warnings.length, 0);
});

test('pigment: presets supply defaults and preset-range warnings', () => {
  const ink = C.pigment({ mixGrams: 200, preset: 'alcoholInk' });
  close(ink.grams, 1); // 0.5 %
  const heavyInk = C.pigment({ mixGrams: 200, preset: 'alcoholInk', pct: 2 });
  assert.ok(heavyInk.warnings.some((w) => /typical/.test(w)));
  assert.ok(heavyInk.warnings.some((w) => /solvent/.test(w)));
  assert.throws(() => C.pigment({ mixGrams: 100, pct: 100 }), RangeError);
});

// ---------------------------------------------------------------------------
// 5. Project cost
test('cost: $100 per US gallon, 1 gallon project = $100, 1 pack', () => {
  const r = C.projectCost({ volumeMl: C.ML_PER_US_GAL, price: 100, packSize: 1, packUnit: 'gal' });
  close(r.projectCost, 100, 1e-9);
  assert.equal(r.packs, 1);
  close(r.leftoverMl, 0, 1e-6);
});

test('cost: per liter pricing, margin, per-layer split, packs to buy', () => {
  // €40 per 1 L; 2500 mL + 10 % = 2750 mL → €110; 2 layers → €55 each; 3 packs = €120
  const r = C.projectCost({ volumeMl: 2500, price: 40, packSize: 1, packUnit: 'L', marginPct: 10, layers: 2 });
  close(r.exactCost, 100);
  close(r.projectCost, 110);
  close(r.perLayerCost, 55);
  close(r.perLayerMl, 1375);
  assert.equal(r.packs, 3);
  close(r.packSpend, 120);
  close(r.leftoverMl, 250);
});

test('cost: per-gallon rate derived from a per-liter price', () => {
  const r = C.projectCost({ volumeMl: 1000, price: 10, packSize: 1, packUnit: 'L' });
  close(r.perGal, 37.85411784, 1e-9);
});
