# Project Memory (Local)

# MDI Logger — Agent Build Brief

> **What this file is:** a self-contained brief for a coding agent to build the first version of a personal diabetes treatment-logging app. It captures the product, the locked technical decisions, the safety rules, the CGM integration mechanics, the data contract, and a phased build order with acceptance criteria.
>
> **How to use it:**
> - **Claude Code / Cursor:** keep this as `AGENTS.md` (or `CLAUDE.md`) in the repo root.
> - **GitHub Copilot:** also copy the relevant parts into `.github/copilot-instructions.md`.
> - Read **§1 (Safety)** and **§4 (CGM integration)** before writing any code. They are where this project differs from a normal CRUD app.

---

## 0. TL;DR for the agent

You are building **a personal, single-user Android app** that:
1. reads live glucose from an on-device CGM bridge (Juggluco) over a local HTTP endpoint,
2. lets the user log insulin and carbs quickly (incl. by voice),
3. suggests an insulin bolus from the user's own therapy settings, **transparently and on confirmation only**, and
4. keeps an editable treatment history.

It is **not** a published medical device and **not** an automated insulin-delivery system. It informs a human who makes every dosing decision.

**Five hard rules, in priority order:**
1. The bolus calculator **suggests**; the user always sees the full math and confirms manually. Never auto-anything.
2. Never display a stale reading as if it were current, and never let a stale/implausible/noisy reading feed the calculator.
3. All dose / IOB / COB / unit-conversion logic lives in **pure, unit-tested functions**.
4. Therapy parameters (ISF, I:C, DIA, target, insulin types) are **user-entered**. Never invent clinical defaults.
5. Keep it simple and local. Do not add cloud, accounts, or extra dependencies that the MVP scope doesn't require (see §9).

---

## 1. Safety constraints (non-negotiable)

This app handles insulin dosing information. Bugs here can cause hypoglycemia or insulin stacking. Treat the dosing path as safety-critical software.

- **Suggestion, not automation.** The calculator outputs a *suggested* dose. The UI must show every component of the calculation (carb dose, correction, IOB subtracted, rounding) — never a bare number. The user explicitly confirms before anything is logged. Nothing is ever dosed or sent to a device.
- **Trustworthy-data gate.** A reading may only inform a dose if it passes the "good reading" check (§6): fresh, physiologically plausible, low-noise. If it doesn't, the calculator must refuse to suggest a correction and say why.
- **Conservative guardrails.** Enforce a user-configurable **max bolus cap**. Warn (and suppress/limit the correction term) when current BG is below a low threshold. Never produce a negative dose — clamp at 0.
- **Units discipline.** Internal canonical unit is **mg/dL**. Provide an mmol/L display toggle handled by a *single* conversion layer. Never mix units in storage or math.
- **No fabricated clinical data.** Do not seed ISF/ICR/DIA/target with "typical" values. Ship with empty/required fields and make the user enter them.
- **Validate the math.** Provide a test suite with explicit input→output vectors for the dose and IOB functions so the human can cross-check them against known-good references (AAPS / their clinician's settings) before relying on the app.

---

## 2. Product overview

A personal logger for someone managing type-1 diabetes on **MDI (multiple daily injections)** during a break from an insulin pump. Conceptually: the parts of AAPS/xDrip+ the user relies on day to day — live CGM, fast logging, a bolus helper — **minus the closed-loop automation**, plus nicer logging UX.

Primary user: the developer themself. Single user, single device, offline-capable.

The three core screens (from the approved mockups):
- **Dashboard** — current glucose + trend arrow + source label + connection/stale status; a trend graph with a target band; IOB and COB; large *Add Insulin* / *Add Carbs* actions; a Time-in-Range stat; a quick-add FAB; bottom nav.
- **History** — reverse-chronological timeline grouped by day. Meal entries (optional photo, name, carb count) and insulin entries (name, units, basal/bolus tag). Each entry editable and deletable.
- **Settings** — Integrations, Account/Profile (stub for MVP), Display & Theme, **Treatment Configurations** (insulins, DIA, ISF, I:C, meds), Notifications (stub), Data & Sharing (export/delete), Help.

---

## 3. Locked technical decisions

| Decision | Choice | Notes |
|---|---|---|
| Framework | **React Native + Expo, TypeScript (strict)** | Matches the developer's existing stack. |
| Build profile | **Expo Dev Client / prebuild** — **not Expo Go** | Required for native speech-to-text and the cleartext network config. |
| Platform | **Android only** for v1 | Primary device: Pixel 7. |
| Responsive target | Phone-first; must remain usable on a **~3-inch screen (Jelly Star)** | Single-column collapse, large touch targets. Bonus, not a blocker. |
| Persistence | **Local-first, on-device.** Recommended: `expo-sqlite` | Relational data, simple, no server. No cloud, no accounts in v1. |
| CGM source | **Abbott FreeStyle Libre via Juggluco** (on-device) | See §4. Dexcom/Stelo are future. |
| Distribution | **Private repo, sideloaded APK** via `eas build` | **Not** the Play Store (a bolus calculator can trigger medical-device review). |
| Glucose units | **mg/dL** canonical, mmol/L display toggle | Single conversion layer. |

---

## 4. CGM data integration (read carefully — this is the unusual part)

The user runs **Juggluco** on the phone, which reads the Libre sensor and exposes a **local Nightscout-compatible web server**. The same endpoint is also served by **xDrip+** (which the user keeps running for followers/web sync), so xDrip+ is a drop-in fallback source.

**Endpoint:** `http://127.0.0.1:17580/sgv.json?count=N`
Returns a newest-first JSON array of reading objects (see §5). Empty `[]` means "no current data."

**Three constraints that will otherwise burn hours:**

1. **Loopback is device-relative — the app must run on the *same physical device* as Juggluco.**
   `127.0.0.1` means "this machine, whoever is asking." Juggluco's server is bound to loopback on the phone. So:
   - App on the **physical phone** (dev client) → reaches Juggluco. ✅ This is the target.
   - App in an **emulator** → the emulator's own loopback, *not* the phone's. ❌ Do not develop the CGM path against an emulator.

2. **Android blocks cleartext HTTP by default (API 28+).** A `fetch` to `http://127.0.0.1:17580` will fail with a generic "Network request failed" until cleartext-to-localhost is allowed. Configure this in **Phase 0**, before anything else, e.g. via `expo-build-properties` (`android.usesCleartextTraffic: true`) or a scoped network-security-config that permits cleartext to `127.0.0.1`. If a fetch fails but the same URL works in the phone's browser, this config is the cause — it is not a code bug.

3. **Poll cadence.** Libre via Juggluco updates roughly once per minute. Poll every **30–60 s**; do not hammer the endpoint. Handle the no-data (`[]`) branch without crashing.

*(Optional, future)* Juggluco/xDrip can also be exposed over the LAN ("Open Web Service") for off-device viewing, but that exposes the service across network interfaces and should be paired with the api-secret. Not needed for the app.

---

## 5. Data contract — `sgv.json` reading object

A reading object contains (field names as emitted by Juggluco/xDrip):

| Field | Type | Meaning | Use it for |
|---|---|---|---|
| `sgv` | number | Glucose value, **always mg/dL** | The reading. |
| `date` | number | Timestamp, **epoch milliseconds** | **Staleness + correct time axis. Required.** |
| `dateString` | string | ISO timestamp | Human-readable time. |
| `delta` | number | Change vs the previous reading | Quick rate — *but see warning below*. |
| `direction` | string | Trend label. Juggluco emits e.g. `"Flat"` / `"raised"` + a number (the number ≈ slope/angle). Standard NS uses an enum (`Flat`, `SingleUp`, `FortyFiveUp`, …). | Trend arrow. Handle both; prefer the numeric slope if present. |
| `filtered` | number | Smoothed raw sensor value | Diagnostics only. |
| `unfiltered` | number | Instantaneous raw sensor value | Diagnostics only. |
| `noise` | number | Data-quality flag (`1` = clean; higher = suspect) | Part of the "good reading" gate. |
| `units_hint` | string | `"mgdl"` | Confirms unit handling. |
| `rssi` | number | Bluetooth signal strength; **almost always a constant `100`** | **Ignore. It is NOT a timestamp.** |
| `_id` | string | Unique id per reading | Deduplication across overlapping polls. |

**Critical warning on `delta` and `direction`:** both are pre-computed by the bridge and both silently assume readings are evenly spaced. After a sensor gap (warmup, signal loss, phone out of range), `delta` is a normal change stretched over several missed readings — i.e. a *slower* real rate than it appears — and the trend angle is wrong the same way. **`date` is the only field that tells you whether to trust them.** Compute or validate rate-of-change using the real interval, never the array index. Do not assume a fixed sampling period.

---

## 6. "Good reading" validation (the trust gate)

Distinguish three states, and handle each explicitly:
- **No data** — response is `[]` or empty. Show a "no recent data" state. Not an error.
- **Bad data** — a reading exists but fails validation. Show it as untrusted; do not let it feed the calculator.
- **Good data** — passes all checks. Safe to display as current and to inform a dose.

A reading is **good** when all hold (thresholds configurable; defaults are starting points to confirm with the human, **not** to hardcode silently):
- **Fresh:** `now - date` ≤ ~10 minutes (Libre updates ~1/min, so 10 min already means several misses).
- **Plausible:** `sgv` within ~40–400 mg/dL. Reject `0` and any error sentinels.
- **Clean:** `noise` low (ideally `1`).

The Dashboard may *display* a stale/bad reading but must visibly mark it as such. The calculator must **refuse** to produce a correction from a non-good reading and state the reason.

---

## 7. Therapy model & bolus math

**Treatment Configurations** the user must be able to set (these drive the calculator):
- Insulins: a long-acting **basal** (e.g. Lantus) and a rapid-acting **bolus** insulin.
- **DIA** (duration of insulin action) and insulin activity model (see below).
- **ISF** (correction factor) and **I:C / ICR** (insulin-to-carb ratio), each as **time-blocked schedules**, not single values.
- **Target** BG (or target range).
- **Pen increment** (dose rounding step, e.g. 0.5 U or 1 U) — confirm with the human.

**Bolus suggestion (document this formula in code and surface it in the UI):**
```
carbBolus   = carbs / ICR
correction  = (currentBG - targetBG) / ISF      // only if reading is "good"; suppress/limit if BG is low
suggested   = carbBolus + correction - IOB       // subtract IOB to prevent stacking
final       = clampToZero( round(suggested, penIncrement) )
final       = min(final, maxBolusCap)
```
- Show **every term** (carb dose, correction, −IOB, rounding) in the confirmation UI.
- **Extended carbs:** log them as a flag/field in v1; the v1 calculator treats total carbs simply. True split/extended dosing is a v1.x refinement — do not build it now.
- **Trend:** *display* it. Any automatic trend adjustment must be optional and conservative; default off for v1.

**IOB (insulin on board):**
- Track IOB from **rapid-acting bolus** entries only. Long-acting basal (e.g. Lantus) is **not** part of bolus IOB and must not be subtracted in the formula above.
- Recommended model: **exponential** activity curve with configurable DIA and peak (peak ~75 min is typical for rapid-acting). A linear model is simpler but less accurate. **Flag this as a decision for the human** rather than picking silently.

**COB (carbs on board):** decay logged carbs over an absorption window (linear or carbs/hr). Configurable. Lower stakes than IOB.

---

## 8. v1 (MVP) scope

Build these, in the order of §10:

- **CGM display:** live `sgv`, trend arrow (from `direction`/slope), source label, connection/stale status dot, trend graph with target band.
- **Treatment Configurations:** all settings in §7, persisted.
- **Logging:**
  - *Add Insulin* — basal/bolus selector, units, timestamp (default now, editable).
  - *Add Carbs* — carb amount, extended-carb flag, optional meal note, timestamp.
  - **Voice-to-text** entry for meals/carbs (native speech module; this is why a dev client is required).
- **History:** day-grouped timeline of insulin + carb entries; edit and delete.
- **Bolus calculator:** §7. Built last, on the tested data + IOB foundation.
- **Settings:** Display & Theme (dark/light, font scale), units toggle, **data export (CSV/JSON) + delete**.
- **IOB / COB** computed from logged treatments and shown on the Dashboard.

---

## 9. Explicitly OUT of scope for v1 (do not build)

Do not gold-plate. These are deferred to v2+ and must not be started without the human's go-ahead:
- AI / photo-based meal & macro analysis (photo entry).
- Followers / data sharing; cloud sync; user accounts.
- Garmin (or any) **watch app** — separate Connect IQ / Monkey C stack.
- Persistent lock-screen / pulldown notification widget.
- Critical hypo/hyper **alerts** (the user gets these from xDrip today).
- Android Auto, landscape mode, Health Connect / fitness-data integration, care-provider report sharing.

---

## 10. Build order & acceptance criteria

Build in this sequence. The riskiest unknown (the data pipe) is proven first; the safety-critical calculator is built last, on a tested foundation.

**Phase 0 — Foundation & data spike**
- Init the Expo + TS project with a dev client; configure cleartext-to-localhost (§4.2).
- Spike: `fetch('http://127.0.0.1:17580/sgv.json?count=1')` on the physical device, parse, render the latest `sgv` on screen.
- ✅ *Done when:* the live glucose value shows on the phone, pulled from Juggluco, and the no-data (`[]`) case is handled.

**Phase 1 — Data model & Treatment Configurations**
- `expo-sqlite` schema: glucose cache, insulin entries, carb entries, profile (insulins, DIA, time-blocked ISF & ICR, target). Units conversion layer.
- Treatment Configurations UI.
- ✅ *Done when:* therapy settings persist across restart; the units toggle round-trips correctly.

**Phase 2 — Dashboard / live display**
- Poll loop, trend graph with target band, value + arrow + source + stale status. IOB/COB from logged treatments. TIR stat.
- ✅ *Done when:* the Dashboard reflects live data and recomputes IOB/COB as treatments are added.

**Phase 3 — Logging & History**
- Add Insulin / Add Carbs sheets (write to DB); voice-to-text for carbs/meals; History timeline with edit/delete.
- ✅ *Done when:* entries can be created by hand and by voice, and edited/deleted from History.

**Phase 4 — Bolus calculator (safety-critical)**
- Pure, unit-tested dose/IOB functions; transparent breakdown UI; explicit user confirmation; guardrails (max cap, low-BG warning, good-reading gate); test vectors for human validation.
- ✅ *Done when:* the suggestion shows its full derivation, refuses on bad data, respects the cap, and matches the provided test vectors.

**Phase 5 — Polish, responsive, build**
- Theme + font scaling; ~3-inch responsive pass; data export/delete; empty/error/stale states; accessibility.
- `eas build` → signed APK installable on the Pixel 7.
- ✅ *Done when:* a sideloadable APK runs as a daily driver.

---

## 11. Engineering conventions & how to work

- **TypeScript strict mode.** Model the reading object and DB rows as explicit types.
- **Pure, tested core.** All dose/IOB/COB/units math in pure functions with unit tests. No clinical math buried in components.
- **Small, reviewable increments.** Commit per logical step; explain non-obvious decisions in the message/PR.
- **Minimal dependencies.** Prefer the platform and a small charting lib over heavy frameworks. Justify any new dependency.
- **No secrets in the repo.** If a Juggluco api-secret is ever used, read it from config, not source.
- **Flag, don't guess, on anything clinical or ambiguous.** Surface open questions (see §12) to the human instead of inventing an answer. This is more important than "finishing."
- **Don't expand scope.** If a task seems to need something from §9, stop and ask.

---

## 12. Open decisions to surface to the human (do not silently choose)

1. **IOB model:** exponential (recommended, configurable DIA/peak) vs linear.
2. **Pen increment:** 0.5 U vs 1 U dose rounding.
3. **"Good reading" thresholds:** staleness window, plausible sgv range, noise cutoff (defaults in §6 are starting points).
4. **Charting library** for the trend graph.
5. **Target:** single target BG vs a target range for the correction term.
6. Whether to **mirror logged treatments back to xDrip** (so follower IOB/COB stays in sync) — likely v1.x, confirm.

---

*This brief reflects decisions made with the developer. The dosing math and "good reading" thresholds in particular should be validated by the developer against their existing AAPS / clinician settings before the app is relied upon for real treatment decisions.*
## Local Notes

