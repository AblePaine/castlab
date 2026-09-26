/*
 * CastLab formula module — the five engines behind every calculator page.
 *
 * Pure functions, no DOM. Works in the browser (window.CastLab) and in node
 * (require('./assets/castlab.js')) so tests/ exercise the exact code the
 * pages run. Every formula carries its derivation; SPEC.md is the prose
 * version, and any figure marked CONTESTED there is footnoted on the page.
 *
 * Conventions:
 *   - Internal units: grams (g), millilitres (mL), millimetres (mm), cm².
 *     1 cm³ = 1 mL exactly.
 *   - Invalid input (non-finite, non-positive where a size is required)
 *     throws RangeError. Safety refusals are NOT exceptions: they come back
 *     as { refused: true, reason } so the page can explain them.
 *   - Engines return raw numbers; rounding is the page's job.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CastLab = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Unit constants (all exact by definition, no rounding)
  //   1 in        = 2.54 cm                    (1959 international inch)
  //   1 in³       = 2.54³ cm³ = 16.387064 mL
  //   1 US gal    = 231 in³   = 3785.411784 mL
  //   1 US qt     = gal / 4   = 946.352946 mL
  //   1 US fl oz  = gal / 128 = 29.5735295625 mL
  //   1 oz (avdp) = 28.349523125 g
  // ---------------------------------------------------------------------
  var ML_PER_IN3 = 16.387064;
  var ML_PER_US_GAL = 231 * ML_PER_IN3;
  var ML_PER_US_QT = ML_PER_US_GAL / 4;
  var ML_PER_US_FLOZ = ML_PER_US_GAL / 128;
  var G_PER_OZ = 28.349523125;

  var CM_PER = { mm: 0.1, cm: 1, m: 100, in: 2.54, ft: 30.48 };
  var ML_PER = { mL: 1, L: 1000, flOz: ML_PER_US_FLOZ, qt: ML_PER_US_QT, gal: ML_PER_US_GAL };

  // Default specific gravities (g/mL). CONTESTED/product-specific — see SPEC §1.
  var DEFAULT_SG_RESIN = 1.15;
  var DEFAULT_SG_HARDENER = 0.95;

  // Exotherm threshold for a single layer, mL. See SPEC §3.
  var EXOTHERM_WARN_ML = 1000;

  // Floating-point slack for depth comparisons (mm). 12 / 6 must be 2 layers,
  // not 3, and 6.0000000001 mm must not be refused against a 6 mm limit.
  var EPS = 1e-9;

  // Tolerance for "did the user raise the max above the preset?" only. A
  // 50 mm preset shown as 1.969 in converts back to 50.013 mm; that is a
  // display round-trip, not a change. 0.05 mm is below anything measurable
  // in a mold. Refusals still compare strictly (EPS) against the max as set.
  var DISPLAY_TOL_MM = 0.05;

  // --- validation helpers ------------------------------------------------
  function num(v, name) {
    var n = typeof v === 'string' ? parseFloat(v) : v;
    if (typeof n !== 'number' || !isFinite(n)) throw new RangeError(name + ' must be a number');
    return n;
  }
  function pos(v, name) {
    var n = num(v, name);
    if (n <= 0) throw new RangeError(name + ' must be greater than zero');
    return n;
  }
  function nonNeg(v, name) {
    var n = num(v, name);
    if (n < 0) throw new RangeError(name + ' cannot be negative');
    return n;
  }
  function oneOf(v, allowed, name) {
    if (allowed.indexOf(v) === -1) throw new RangeError(name + ' must be one of: ' + allowed.join(', '));
    return v;
  }

  // --- unit conversion ---------------------------------------------------
  function lengthToCm(value, unit) {
    oneOf(unit, Object.keys(CM_PER), 'length unit');
    return num(value, 'length') * CM_PER[unit];
  }
  function volumeToMl(value, unit) {
    oneOf(unit, Object.keys(ML_PER), 'volume unit');
    return num(value, 'volume') * ML_PER[unit];
  }
  /** One volume in every unit the pages display. */
  function volumeBreakdown(mL) {
    return { mL: mL, L: mL / 1000, flOz: mL / ML_PER_US_FLOZ, qt: mL / ML_PER_US_QT, gal: mL / ML_PER_US_GAL };
  }

  // =======================================================================
  // 1. MIX RATIO
  // =======================================================================
  // A ratio a:b (resin:hardener) is stated on a basis — by weight or by
  // volume. The two are NOT interchangeable because the parts have
  // different densities.
  //
  // Parametrise the batch by a scale factor k:
  //   by weight:  m_r = a·k,        m_h = b·k           (grams)
  //   by volume:  V_r = a·k,        V_h = b·k           (mL)
  //               m_r = a·k·SG_r,   m_h = b·k·SG_h
  // and in both cases V = m / SG for each part.
  //
  // Every output is therefore linear in k: compute each quantity at k = 1
  // ("per unit"), then k = known amount / (per-unit value of the known
  // quantity). This handles "I know the total", "I know the resin" and "I
  // know the hardener", in grams or mL, with one formula.
  //
  // Totals assume the part volumes are additive. Real mixes shrink very
  // slightly on mixing (and more on cure); SPEC §1 flags this. Mass is
  // conserved exactly, so weighing is the more precise method.
  var MIX_PRESETS = {
    '1:1': [1, 1],
    '2:1': [2, 1],
    '3:1': [3, 1],
    '4:1': [4, 1]
  };

  function mixRatio(o) {
    var a = pos(o.resinParts, 'resin parts');
    var b = pos(o.hardenerParts, 'hardener parts');
    var basis = oneOf(o.basis || 'volume', ['weight', 'volume'], 'basis');
    var sgR = pos(o.sgResin == null ? DEFAULT_SG_RESIN : o.sgResin, 'resin specific gravity');
    var sgH = pos(o.sgHardener == null ? DEFAULT_SG_HARDENER : o.sgHardener, 'hardener specific gravity');
    var known = o.known || {};
    var part = oneOf(known.part, ['total', 'resin', 'hardener'], 'known part');
    var unit = oneOf(known.unit, ['g', 'mL'], 'known unit');
    var amount = pos(known.amount, 'amount');

    // Per-unit (k = 1) masses.
    var rG1 = basis === 'weight' ? a : a * sgR;
    var hG1 = basis === 'weight' ? b : b * sgH;
    // Per-unit volumes: V = m / SG.
    var rMl1 = rG1 / sgR;
    var hMl1 = hG1 / sgH;

    var per = {
      resin: { g: rG1, mL: rMl1 },
      hardener: { g: hG1, mL: hMl1 },
      total: { g: rG1 + hG1, mL: rMl1 + hMl1 }
    };
    var k = amount / per[part][unit];

    var resin = { g: rG1 * k, mL: rMl1 * k };
    var hardener = { g: hG1 * k, mL: hMl1 * k };
    var total = { g: resin.g + hardener.g, mL: resin.mL + hardener.mL };

    return {
      basis: basis,
      resin: resin,
      hardener: hardener,
      total: total,
      // Equivalent ratios expressed as "resin parts per 1 part hardener".
      weightRatio: rG1 / hG1,
      volumeRatio: rMl1 / hMl1,
      // Mixed density ρ = (m_r + m_h) / (V_r + V_h), additive-volume assumption.
      mixedDensity: (rG1 + hG1) / (rMl1 + hMl1),
      // Mass fractions, useful for scaling on a scale with tare.
      resinMassFraction: rG1 / (rG1 + hG1),
      resinVolumeFraction: rMl1 / (rMl1 + hMl1)
    };
  }

  // =======================================================================
  // 2. POUR VOLUME
  // =======================================================================
  // All shapes reduce to V = footprint area × depth, with lengths converted
  // to cm first so that V lands in cm³ = mL.
  //
  //   rectangle:   A = L · W
  //   cylinder:    A = π · (d/2)²
  //   river table: A = L · ḡ, where ḡ is the mean gap between the slabs.
  //     Two ways to get ḡ:
  //       (a) measure the gap directly at several points and average;
  //       (b) inner mold width minus the (average) width of each slab.
  //     (b) is the "wood displacement" form: V = (W·L·D) − Σ(w_i·L·D)
  //     = (W − Σw_i)·L·D, i.e. mold volume minus the volume of wood that sits
  //     in it at full pour depth. Averaging widths is exact for straight-sided
  //     tapers and a good estimate for live edges measured at enough points.
  //
  // `displacementMl` subtracts anything else sitting in the pour (embedded
  // objects, a slab in a rectangle mold) by its own volume — e.g. measured by
  // water displacement.
  //
  // Margin: CONTESTED planning allowance for residue left in cups, leaks,
  // wood soak-in and live-edge voids (SPEC §2). Reported separately; the
  // exact geometric volume is always shown on its own.
  function withMargin(mL, marginPct) {
    var m = nonNeg(marginPct == null ? 0 : marginPct, 'margin');
    return mL * (1 + m / 100);
  }

  function finishVolume(grossMl, o) {
    var disp = nonNeg(o.displacementMl == null ? 0 : o.displacementMl, 'displacement');
    if (disp >= grossMl) throw new RangeError('displacement must be smaller than the mold volume');
    var net = grossMl - disp;
    var marginPct = o.marginPct == null ? 0 : o.marginPct;
    var planned = withMargin(net, marginPct);
    return {
      grossMl: grossMl,
      displacementMl: disp,
      exact: volumeBreakdown(net),
      marginPct: marginPct,
      planned: volumeBreakdown(planned)
    };
  }

  function rectangleVolume(o) {
    var u = o.unit || 'cm';
    var L = pos(lengthToCm(o.length, u), 'length');
    var W = pos(lengthToCm(o.width, u), 'width');
    var D = pos(lengthToCm(o.depth, u), 'depth');
    var r = finishVolume(L * W * D, o);
    r.areaCm2 = L * W;
    return r;
  }

  function cylinderVolume(o) {
    var u = o.unit || 'cm';
    var d = pos(lengthToCm(o.diameter, u), 'diameter');
    var D = pos(lengthToCm(o.depth, u), 'depth');
    var area = Math.PI * (d / 2) * (d / 2);
    var r = finishVolume(area * D, o);
    r.areaCm2 = area;
    return r;
  }

  function mean(list, name) {
    if (!Array.isArray(list) || list.length === 0) throw new RangeError(name + ': enter at least one measurement');
    var s = 0;
    for (var i = 0; i < list.length; i++) s += pos(list[i], name);
    return s / list.length;
  }

  function riverTableVolume(o) {
    var u = o.unit || 'cm';
    var L = pos(lengthToCm(o.length, u), 'length');
    var D = pos(lengthToCm(o.depth, u), 'depth');
    var gapCm;
    var method;
    if (o.gapWidths) {
      method = 'gap';
      gapCm = mean(o.gapWidths, 'gap width') * CM_PER[u];
    } else {
      method = 'mold';
      var W = pos(lengthToCm(o.moldWidth, u), 'mold width');
      var slabs = o.slabWidths;
      if (!Array.isArray(slabs) || slabs.length === 0) throw new RangeError('slab widths: enter at least one slab');
      // Each entry is a slab's average width (the page averages per slab).
      var wood = 0;
      for (var i = 0; i < slabs.length; i++) wood += pos(slabs[i], 'slab width') * CM_PER[u];
      gapCm = W - wood;
      if (gapCm <= 0) throw new RangeError('slabs are as wide as the mold — no gap left to fill');
    }
    var r = finishVolume(L * gapCm * D, o);
    r.areaCm2 = L * gapCm;
    r.meanGapCm = gapCm;
    r.method = method;
    return r;
  }

  // =======================================================================
  // 3. DEEP-POUR PLANNER
  // =======================================================================
  // Epoxy cure is exothermic; heat builds faster than a thick, massive pour
  // can shed it, and runaway exotherm can crack, yellow, smoke or ignite.
  // Product max-depth ratings are the manufacturer's safe envelope.
  //
  //   layers  n = ⌈ total depth / max layer depth ⌉          (auto)
  //   depth   d = total / n        (equal layers: each as thin as possible)
  //   volume  V_layer = area × d                           (cm² × mm / 10 = mL)
  //
  // A user-forced layer count that makes d > max is REFUSED, not warned.
  // A layer over 1 L gets an exotherm warning: heat generation scales with
  // mass, so depth alone doesn't capture risk (SPEC §3, CONTESTED threshold).
  //
  // Recoat timing is product-, temperature- and mass-specific; we compute a
  // schedule from the interval the user enters and never invent one.
  var PRODUCT_TYPES = {
    tabletop: {
      label: 'Tabletop / coating epoxy',
      maxLayerMm: 6,
      // Placeholder only — prefilled so the schedule has a value, labelled
      // "replace with your TDS" on the page. CONTESTED (SPEC §3).
      recoatHours: 6
    },
    deepPour: {
      label: 'Deep-pour / casting epoxy',
      maxLayerMm: 50,
      recoatHours: 24
    }
  };

  function deepPour(o) {
    var type = oneOf(o.productType || 'tabletop', Object.keys(PRODUCT_TYPES), 'product type');
    var preset = PRODUCT_TYPES[type];
    var total = pos(o.totalDepthMm, 'total depth');
    var max = pos(o.maxLayerMm == null ? preset.maxLayerMm : o.maxLayerMm, 'max layer depth');
    var area = o.areaCm2 == null ? null : pos(o.areaCm2, 'pour area');
    var recoat = nonNeg(o.recoatHours == null ? preset.recoatHours : o.recoatHours, 'recoat interval');

    var warnings = [];
    if (max > preset.maxLayerMm + DISPLAY_TOL_MM) {
      warnings.push('Max layer depth raised above the ' + preset.maxLayerMm + ' mm default for ' +
        preset.label.toLowerCase() + '. Only do this if your product\'s technical data sheet states it.');
    }

    var autoLayers = Math.max(1, Math.ceil(total / max - EPS));
    var layers = autoLayers;
    if (o.layers != null && o.layers !== '') {
      layers = pos(o.layers, 'layer count');
      if (Math.floor(layers) !== layers) throw new RangeError('layer count must be a whole number');
    }
    var layerDepth = total / layers;

    if (layerDepth > max + EPS) {
      return {
        refused: true,
        reason: layers + ' layer' + (layers === 1 ? '' : 's') + ' of ' + round(layerDepth, 2) +
          ' mm each exceeds the ' + max + ' mm maximum for this product. A single pour this deep risks ' +
          'runaway exotherm (cracking, smoking, fire). Use at least ' + autoLayers + ' layers.',
        minLayers: autoLayers,
        maxLayerMm: max,
        productType: type,
        warnings: warnings
      };
    }

    var layerMl = area == null ? null : area * layerDepth / 10;
    if (layerMl != null && layerMl > EXOTHERM_WARN_ML) {
      warnings.push('Each layer is ' + round(layerMl / 1000, 2) + ' L. Pours over 1 L in one layer ' +
        'carry real exotherm risk even within the depth limit — heat scales with mass. Pour in a cool ' +
        'room, don\'t mix large batches ahead of time, and monitor the first hour.');
    }

    var schedule = [];
    for (var i = 0; i < layers; i++) {
      schedule.push({ layer: i + 1, startHour: i * recoat, topMm: layerDepth * (i + 1) });
    }

    return {
      refused: false,
      productType: type,
      maxLayerMm: max,
      layers: layers,
      minLayers: autoLayers,
      layerDepthMm: layerDepth,
      layerMl: layerMl,
      totalMl: layerMl == null ? null : layerMl * layers,
      recoatHours: recoat,
      lastPourStartHour: (layers - 1) * recoat,
      schedule: schedule,
      warnings: warnings
    };
  }

  // =======================================================================
  // 4. PIGMENT LOADING
  // =======================================================================
  // Two ways to state "p % pigment", and the difference matters at the
  // margins (SPEC §4, CONTESTED convention):
  //   basis 'mix'   (default, common practice): % of resin + hardener weight
  //                  g = p · M
  //   basis 'final': % of the finished, pigmented mix
  //                  g / (M + g) = p   ⇒   g = p · M / (1 − p)
  // Both are reported so the user can match whatever their pigment maker
  // means. Above 5 % is a hard-cap warning: pigment is not reactive, and past
  // a point it dilutes the cure and weakens the part.
  var PIGMENT_HARD_CAP_PCT = 5;
  var PIGMENT_PRESETS = {
    mica: { label: 'Mica powder', defaultPct: 3, typicalMinPct: 1, typicalMaxPct: 3 },
    liquidDye: { label: 'Liquid dye / epoxy colourant', defaultPct: 1, typicalMinPct: 0.1, typicalMaxPct: 2 },
    alcoholInk: { label: 'Alcohol ink', defaultPct: 0.5, typicalMinPct: 0.1, typicalMaxPct: 1 }
  };

  function pigment(o) {
    var M = pos(o.mixGrams, 'mix weight');
    var type = o.preset == null ? null : oneOf(o.preset, Object.keys(PIGMENT_PRESETS), 'pigment preset');
    var preset = type ? PIGMENT_PRESETS[type] : null;
    var pct = pos(o.pct == null ? (preset ? preset.defaultPct : 3) : o.pct, 'pigment %');
    if (pct >= 100) throw new RangeError('pigment % must be below 100');
    var basis = oneOf(o.basis || 'mix', ['mix', 'final'], 'basis');
    var p = pct / 100;

    var g = basis === 'mix' ? p * M : p * M / (1 - p);
    var warnings = [];
    if (pct > PIGMENT_HARD_CAP_PCT) {
      warnings.push('Above ' + PIGMENT_HARD_CAP_PCT + '% pigment. Excess pigment weakens the cure — ' +
        'expect soft spots, tackiness or a brittle part. Stay at or below ' + PIGMENT_HARD_CAP_PCT +
        '% unless the pigment maker states otherwise.');
    } else if (preset && pct > preset.typicalMaxPct) {
      warnings.push('Above the typical ' + preset.typicalMinPct + '–' + preset.typicalMaxPct + '% range for ' +
        preset.label.toLowerCase() + '.');
    }
    if (type === 'alcoholInk' && pct > preset.typicalMaxPct) {
      warnings.push('Alcohol ink carries solvent into the mix; heavier loads are a common cause of soft or tacky cure.');
    }

    return {
      grams: g,
      ounces: g / G_PER_OZ,
      pct: pct,
      basis: basis,
      pctOfMix: 100 * g / M,
      pctOfFinal: 100 * g / (M + g),
      finalGrams: M + g,
      warnings: warnings
    };
  }

  // =======================================================================
  // 5. PROJECT COST
  // =======================================================================
  // Unit price from what the user paid for a pack of any size:
  //   c = price / (pack size in mL)                       (currency per mL)
  //   cost(project) = V_planned · c
  //   cost(layer)   = cost(project) / n                   (equal layers)
  //   packs to buy  = ⌈ V_planned / pack mL ⌉,  spend = packs · price
  // "Pack" is the combined A + B volume (a "1 gallon kit" = 1 gal mixed).
  // SPEC §5 flags kits sold by the size of Part A only.
  function projectCost(o) {
    var V = pos(o.volumeMl, 'volume');
    var price = pos(o.price, 'price');
    var packMl = pos(volumeToMl(pos(o.packSize, 'pack size'), o.packUnit || 'gal'), 'pack size');
    var marginPct = o.marginPct == null ? 0 : o.marginPct;
    var planned = withMargin(V, marginPct);
    var layers = o.layers == null || o.layers === '' ? 1 : pos(o.layers, 'layers');
    if (Math.floor(layers) !== layers) throw new RangeError('layers must be a whole number');

    var perMl = price / packMl;
    var packs = Math.ceil(planned / packMl - EPS);
    return {
      perMl: perMl,
      perL: perMl * 1000,
      perGal: perMl * ML_PER_US_GAL,
      exactCost: V * perMl,
      plannedMl: planned,
      projectCost: planned * perMl,
      layers: layers,
      perLayerCost: planned * perMl / layers,
      perLayerMl: planned / layers,
      packs: packs,
      packSpend: packs * price,
      leftoverMl: packs * packMl - planned
    };
  }

  function round(x, dp) {
    var f = Math.pow(10, dp);
    return Math.round(x * f) / f;
  }

  return {
    // constants
    ML_PER_IN3: ML_PER_IN3,
    ML_PER_US_GAL: ML_PER_US_GAL,
    ML_PER_US_QT: ML_PER_US_QT,
    ML_PER_US_FLOZ: ML_PER_US_FLOZ,
    G_PER_OZ: G_PER_OZ,
    CM_PER: CM_PER,
    ML_PER: ML_PER,
    DEFAULT_SG_RESIN: DEFAULT_SG_RESIN,
    DEFAULT_SG_HARDENER: DEFAULT_SG_HARDENER,
    EXOTHERM_WARN_ML: EXOTHERM_WARN_ML,
    PIGMENT_HARD_CAP_PCT: PIGMENT_HARD_CAP_PCT,
    MIX_PRESETS: MIX_PRESETS,
    PRODUCT_TYPES: PRODUCT_TYPES,
    PIGMENT_PRESETS: PIGMENT_PRESETS,
    // helpers
    lengthToCm: lengthToCm,
    volumeToMl: volumeToMl,
    volumeBreakdown: volumeBreakdown,
    round: round,
    // engines
    mixRatio: mixRatio,
    rectangleVolume: rectangleVolume,
    cylinderVolume: cylinderVolume,
    riverTableVolume: riverTableVolume,
    deepPour: deepPour,
    pigment: pigment,
    projectCost: projectCost
  };
});
