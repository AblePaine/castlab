# CastLab — Engine Specification

CastLab is an epoxy resin casting reference: five calculators that take what you know and return an exact answer. This file is the source of truth for every formula. The code in `assets/castlab.js` carries the same derivations as comments, and `tests/castlab.test.js` checks each one against hand-worked values.

**House rules**

- **Zero guesswork.** Geometry and unit conversion are exact. Where a number depends on the product (specific gravity, max depth, recoat window), it is an editable input with a stated default. The engine never quietly makes one up.
- **Contested figures are flagged.** Anything marked **CONTESTED** below gets a footnote on its page. The engine doesn't pick a side without saying so.
- **Brand-neutral.** No SKUs and no product names. Every input comes off the technical data sheet (TDS) for whatever the user bought.
- **Safety: refuse, don't warn.** A single pour deeper than the product's max depth is refused outright. Softer risks, like a large layer volume or heavy pigment, get a warning.

**Layout**

```
index.html            hub
mix-ratio.html        engine 1
pour-volume.html      engine 2
deep-pour.html        engine 3
pigment.html          engine 4
cost.html             engine 5
assets/castlab.js     formula module (browser global CastLab + node module)
assets/castlab.css    shared styles, mobile-first
tests/castlab.test.js node:test suite — run `npm test`
```

No framework and no build step. Each page is one HTML file that loads the shared module and stylesheet and holds its own UI script inline. Pages pass volumes to one another through query strings (`?ml=…`, `?layers=…`), so the data never leaves the browser.

---

## 0. Units

Internal units are grams, millilitres, millimetres, and cm². 1 cm³ = 1 mL exactly.

| Constant | Value | Basis |
|---|---|---|
| inch | 2.54 cm | exact (1959) |
| in³ | 16.387064 mL | 2.54³ |
| US gallon | 3785.411784 mL | 231 in³, exact |
| US quart | 946.352946 mL | gal / 4 |
| US fl oz | 29.5735295625 mL | gal / 128 |
| oz (avoirdupois) | 28.349523125 g | exact |

"Fluid ounce" and "gallon" always mean the **US** units. Imperial units are not offered. We would rather drop them than risk a silent 4% error (imperial gallon = 4546 mL).

---

## 1. Mix ratio

**Inputs:** ratio `a:b` (resin:hardener; presets 1:1, 2:1, 3:1, 4:1, or custom), basis (weight or volume), resin SG `ρr` (default 1.15), hardener SG `ρh` (default 0.95), and one known amount: total, resin, or hardener, in g or mL.

**Derivation.** Parametrise the batch by a scale factor `k`:

- by weight: `m_r = a·k`, `m_h = b·k`
- by volume: `V_r = a·k`, `V_h = b·k`, so `m_r = a·k·ρr`, `m_h = b·k·ρh`
- for every part: `V = m / ρ`

Every output is linear in `k`. Evaluate each quantity at `k = 1`, then `k = known ÷ (value of the known quantity at k = 1)`. That one formula covers all six known-quantity cases (3 parts × 2 units).

**Outputs:** resin and hardener in g and mL, totals, the equivalent ratio on the other basis, and the mixed density `ρmix = (m_r + m_h)/(V_r + V_h)`.

Example: 1:1 by volume at the default SGs works out to 1.21:1 by weight. Using a volume ratio on a scale gives an off-ratio mix.

**Flags**

- **Default SGs are placeholders (CONTESTED).** Resin (Part A) usually falls around 1.1–1.2 and hardener (Part B) around 0.95–1.05, but the real values vary by product. The TDS gives the actual numbers, and those override the defaults.
- **Use the basis the manufacturer states.** A ratio printed "by volume" is not the same ratio by weight. If the TDS gives both, weighing is more precise.
- **Volume additivity.** Totals in mL assume the two parts' volumes add. Real mixes shrink very slightly on mixing and more on cure. Mass is conserved exactly, which is one more reason to weigh.

---

## 2. Pour volume

**Shapes:** footprint area × depth, with lengths converted to cm first.

| Shape | Area |
|---|---|
| Rectangle | `L · W` |
| Cylinder | `π · (d/2)²` |
| River table | `L · ḡ` |

**River table.** `ḡ` is the mean gap. There are two ways to get it:

1. **Measured gap.** Measure the gap at several points along the length and take the mean.
2. **Wood displacement.** Take the inner mold width minus each slab's average width: `V = (W − Σwᵢ)·L·D`. This is the mold volume minus the volume of wood sitting in it at full pour depth.

Averaging is exact for straight tapers and a close estimate for a live edge measured at enough points.

**Displacement (optional, mL):** the volume of anything else in the pour (embedded objects, a slab in a rectangular mold). The page suggests measuring it by water displacement.

**Margin (optional, %, default 10 on the page) — CONTESTED.** A planning allowance for resin left in cups and on sticks, small leaks, wood soak-in, and live-edge voids. Common advice runs from about 5 to 15%. It isn't geometry, so the exact volume and the planned volume are always shown separately.

**Outputs:** mL, L, US fl oz, and US gal, plus the resin/hardener split at the user's ratio (engine 1 with `known = total mL`).

---

## 3. Deep-pour planner

**Inputs:** product type (sets the default max layer depth), max layer depth (editable), total depth, optional pour area (from the shape inputs), optional forced layer count, and recoat interval in hours (editable).

| Product type | Default max layer | Recoat placeholder |
|---|---|---|
| Tabletop / coating | 6 mm | 6 h |
| Deep-pour / casting | 50 mm | 24 h |

**Derivation.**

- `n = ⌈total / max⌉`, computed with a 1e-9 mm tolerance so 12 / 6 gives 2 and float noise never adds a layer
- equal layers: `d = total / n`, which makes each layer as thin as it can be
- `V_layer = area × d` (cm² × mm ÷ 10 = mL)
- schedule: layer `i` starts at `(i − 1) × recoat` hours

**Safety**

- **Refuse.** If the layer depth `d` exceeds the max, for example because the user forced too few layers, the engine returns `refused: true` with a reason and the minimum layer count. No plan is produced.
- **Warn above 1 L per layer (CONTESTED threshold).** Exotherm heat scales with mass, not just depth. A wide 40 mm layer can run hotter than a narrow 50 mm one. The 1 L line is a conservative rule of thumb, not a physical constant.
- **Raising the max above the preset** is allowed, because some products do rate deeper, but it gets flagged: "only if your TDS states it".

**Flags**

- **Max-depth defaults (CONTESTED).** Tabletop products are commonly rated around 3–6 mm (⅛–¼ in) per coat. Deep-pour products range from about 25 mm to over 100 mm per pour depending on the chemistry, and ratings assume roughly 21–24 °C ambient. The defaults sit at the conservative end, and the TDS wins.
- **Recoat interval (CONTESTED).** This depends on the product, the temperature, and the mass of the pour. Tabletop systems are often recoated in a window of a few hours up to about a day while the surface is still chemically receptive. Past that window, the surface is scuff-sanded before the next coat. Deep-pour systems commonly wait 24–72 h, or until the previous layer has cooled back to room temperature. The prefilled values only exist so the schedule has a number to work with, and the page labels them as placeholders.

---

## 4. Pigment loading

**Inputs:** mix weight in grams (or mL × mixed density), pigment %, basis, and an optional preset.

**Derivation.** There are two conventions for "p % pigment":

- **basis `mix`** (default, the common convention): percent of resin + hardener weight, `g = p·M`
- **basis `final`**: percent of the finished pigmented mix, `g/(M + g) = p`, so `g = p·M/(1 − p)`

Both percentages are reported whichever basis is chosen. **CONTESTED:** pigment makers use both conventions and rarely say which one they mean.

**Presets (all CONTESTED, drawn from common practice rather than any standard):**

| Preset | Default | Typical range |
|---|---|---|
| Mica powder | 3% | 1–3% |
| Liquid dye / epoxy colourant | 1% | 0.1–2% |
| Alcohol ink | 0.5% | 0.1–1% |

**Warnings**

- Above **5%** of any pigment: hard-cap warning. Pigment doesn't react with the resin, and past this point it dilutes the cure, leaving soft spots, tackiness, or a brittle part.
- Above a preset's typical range: soft warning.
- Heavy alcohol ink: adds a note that its solvent is a common cause of soft or tacky cures.
- Pigment is added on top of the A + B mix. It never changes the A:B ratio.

---

## 5. Project cost

**Inputs:** volume in mL (pre-filled from engine 2 via `?ml=`), price paid, pack size and unit (gal, qt, L, fl oz, mL), margin %, and number of layers.

**Derivation**

- `c = price / pack mL` (currency per mL, any currency)
- project cost = `V_planned · c`, where `V_planned = V · (1 + margin)`
- cost per layer = project cost ÷ `n` (equal layers, matching engine 3)
- packs to buy = `⌈V_planned / pack mL⌉`; spend = packs × price; leftover = packs × pack mL − `V_planned`

Rates are also reported per L and per US gal so prices from different sellers can be compared.

**Flag:** "pack size" means the **combined A + B** volume, so a "1 gallon kit" is 1 gal of mixed epoxy. Some kits are named after the size of Part A only, or sold by weight. If yours is, enter the actual combined volume.

---

## Safety posture (every page)

- **Ventilation and PPE:** work in a ventilated space and wear an organic-vapour respirator, nitrile gloves, and eye protection. Uncured epoxy is a skin sensitiser, and allergy builds with exposure.
- **Exotherm:** runaway exotherm can crack, yellow, smoke, or ignite a pour. Never pour deeper than the product's rating, and don't leave a large mixed batch in the cup.
- **Food contact:** not food-safe unless the specific product is certified for food contact **and** has fully cured according to its data sheet.
- CastLab calculates. It doesn't replace the manufacturer's TDS or SDS.

## Open questions for review

1. **Margin default (10%).** It is applied on the pour and cost pages and shown separately from the exact volume. Is 10% the right house default, or should it be 0 so users opt in?
2. **Recoat placeholders (6 h / 24 h).** Should these be left blank to force a TDS entry, at the cost of an empty schedule until the user fills it in?
3. **Tabletop minimum coat.** Tabletop epoxy self-levels to roughly 3 mm (⅛ in), so thinner coats may not flow out. There is no warning for this yet, pending a sourced figure.
