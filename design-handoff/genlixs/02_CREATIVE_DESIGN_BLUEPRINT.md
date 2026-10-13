# 02 · Creative design blueprint — Genlixs

## 1. Experience thesis

> For creators and small businesses who need a usable image, edit or short clip, Genlixs should feel **ready, honest and calm** by putting a creation console first, showing every cost before it is spent, and letting real examples carry the visual weight — so a visitor reaches a first result without guessing what it will cost or what happened to their credits.

Core tension: an expressive creative product vs. financial clarity. Resolution: the dark creative surfaces stay quiet (neutral canvas, one accent per screen) so artwork and the cost/action pair are the loudest elements; operational surfaces switch to a light, dense data canvas with the same type, controls and brand rail.

## 2. Three territories (brand-locked execution variants)

The logo, four colours and Inter are fixed by the brief, so the territories vary composition, motif and density rather than identity.

| | A · Console & Gallery | B · Darkroom contact sheet | C · Layer stack |
| --- | --- | --- | --- |
| Proposition | Creation console on top, editorial gallery beneath — the guide's chosen composition | Results treated like prints on a lightbox: dense contact-sheet grids, film-strip timelines | The symbol's offset lime/orange edges become the system's motif for versions and featured areas |
| Layout DNA | Centered composer, asymmetric 7/5 gallery, varied section forms | Uniform tight grids, horizontal strips | Stacked offset planes, layered cards |
| Strength | Fastest path to Create; matches §02 | Strong for library/history | Ownable, derived from the supplied mark |
| Risk | Can look generic without a motif | Monotonous; weak for first-time visitors; masonry-like grids conflict with §05 | Overuse becomes decoration (§04 limits accents) |
| Score (fit 30 / task 25 / craft 20 / a11y 15 / feasibility 10) | 4.6 | 3.3 | 3.9 |

**Chosen:** A with C's motif used once per screen. Specific decisions:

1. The **layer-stack accent** (lime then orange edge offset behind the card, echoing the symbol) marks only the featured creation area: the public composer and the studio "Continue draft" card.
2. The only glow is a blurred blue→violet field behind the public composer (§04 allows exactly one).
3. A 4-colour **brand rule** (short stacked bars) appears once, in the footer.
4. Step numerals use the symbol's **octagonal** silhouette (clip-path), not a new icon.
5. Blue is reserved for primary actions and current navigation; violet only identifies video; lime only marks positive/eligible states; orange only for "Preview", attention and cost warnings.

## 3. Colour tokens and tested contrast

Core colours are fixed inputs. Derived tints exist only so small text never uses base blue/violet on dark (§04).

| Token | Value | Role |
| --- | --- | --- |
| `brand-blue` / hover | `#1C5DFF` / `#174ED9` | Primary action, active nav |
| `brand-lime` | `#ADDB5A` | Positive / eligible marker, dark text on it |
| `brand-violet` | `#763DFF` | Video identity, avatar |
| `brand-orange` | `#FE5511` | Attention, preview marker, favourite |
| `canvas` / `surface` / `raised` | `#0B0F1A` / `#131A27` / `#1A2333` | Dark layers |
| `line` / `line-strong` | `#2A3548` / `#6B7A94` | Structural divider / form-control boundary |
| `ink` / `muted` | `#F6F8FC` / `#AAB6C8` | Text on dark |
| `link` (derived) | `#A9C1FF` | Small links and info text on dark |
| `violet-on-dark` / `orange-on-dark` / `error-on-dark` (derived) | `#C4A6FF` / `#FF7A45` / `#FF8FA0` | Small coloured text on dark |
| `paper` / `sheet` / `rule` / `rule-strong` | `#F5F7FB` / `#FFFFFF` / `#DCE3EE` / `#7E8BA0` | Light data surfaces; `rule-strong` for form fields |
| `ink-dark` / `muted-dark` | `#172234` / `#52627A` | Text on light |
| Semantic light pairs | success `#2F6A12/#EEF8DD`, info `#1E4FD0/#E8EFFF`, violet `#5B2BD9/#F1EBFF`, attention `#B23C0A/#FFF0E8`, warning `#8A4B00/#FFF4E0`, error `#B42318/#FDECEC` | Badges and notices |

Computed WCAG 2.x ratios (this run, exact opaque pairs):

| Pair | Ratio | Use |
| --- | --- | --- |
| White / `#1C5DFF` | 5.17 | Primary button label |
| White / `#174ED9` | 6.71 | Primary hover |
| `#0B0F1A` / lime | 11.90 | Text on lime |
| `#F6F8FC` / `#131A27` | 16.39 | Body on panels |
| `#AAB6C8` / `#131A27` · `#1A2333` | 8.50 · 7.68 | Secondary text |
| `#A9C1FF` / `#0B0F1A` · `#131A27` | 10.71 · 9.76 | Links on dark |
| `#FF7A45` / `#131A27` | 6.74 | Attention text on dark |
| `#FF8FA0` / `#131A27` | 8.04 | Error text on dark |
| `#C4A6FF` / `#131A27` | 8.50 | Violet text on dark |
| `#6B7A94` / `#1A2333` · `#131A27` | 3.63 · 4.01 | Input boundary (≥ 3:1) |
| `#7E8BA0` / white · `#F5F7FB` | 3.45 · 3.22 | Light input boundary (≥ 3:1) |
| `#172234` / `#F5F7FB` | 14.89 | Data text |
| `#52627A` / white | 6.20 | Data labels |
| `#1C5DFF` / white | 5.17 | Bars and active marks on light |
| Light semantic pairs | 5.33 – 6.47 | Badges |
| White / `#D63652` | 4.66 | Destructive button |
| `#C3CCDB` / `#33405A` | 6.42 | Disabled primary on dark (distinguishable) |

## 4. Typography, spacing, shape

- **Inter Variable**, self-hosted (`@fontsource-variable/inter`, OFL 1.1). `cv11`, `ss01` features on.
- Scale: home h1 32 → 44 → 56 px (`leading-[1.08]`), section h2 26 → 30 → 36 px, app titles 26–32 px, panel titles 16–18 px, body 15–17 px, labels 12–14 px, metrics 30–32 px. Body line-height 1.55.
- Tabular numerals only in tables, ledgers and axes; large stat values use proportional figures.
- Spacing: Tailwind 4-px scale; public gutters 16 / 24 / 40 px; public sections 64 / 96 px; app groups 16–24 px.
- Containers: public 1360 px; studio 1200–1400 px; composer 880 px.
- Radii: controls 11 px, media 16 px, dialogs 20 px. Shadows only on dialogs, dropdowns and light cards.

## 5. Component library and states

| Component | File | States implemented |
| --- | --- | --- |
| Button / ButtonLink | `ui/button.tsx` | primary, secondary, ghost, danger, light variants; hover, focus ring, busy (spinner + `aria-busy`), disabled with visible reason via `aria-describedby` |
| Badge / ConceptTag | `ui/badge.tsx` | success, info, violet, attention, warning, error, neutral, busy, pending — always icon + text |
| Dialog | `ui/dialog.tsx` | native `<dialog>`: focus contained, Escape, backdrop click, focus return, dark/light |
| CopyButton | `ui/copy-button.tsx` | idle, copied, failed (live region) |
| MediaFrame | `ui/media-frame.tsx` | fixed ratios, reserved space, concept tag |
| CompareSlider | `compare-slider.tsx` | drag, arrow keys, three discrete buttons, focus ring |
| Composer | `public/composer.tsx` | tabs (arrow keys), example-loaded notice, limit counter, edit-tab sign-in reference slot |
| ModelPicker / RatioChips / Segmented / Toggle | `studio/controls.tsx` | available, experimental, maintenance (disabled with note), selected, focus |
| ReferenceUploader | `studio/reference-uploader.tsx` | empty, drag-over, validating, failed (type/size), accepted, replace, remove, sample |
| Quote + Generate | `studio/workspace.tsx` | updating quote, valid with countdown, expired (refresh), insufficient (top-up link), busy |
| JobStatus | `studio/job-status.tsx` | waiting (cancel), submitting, confirming (no resubmit), generating, delayed, saving, ready, failed, cancelled |
| ResultMedia / Actions / Details | `studio/result-view.tsx` | zoom, compare, video, download, reuse, favourite, share (create/revoke), delete (keeps record) |
| Library card | `studio/library.tsx` | ready, running, failed, expired, favourite, shared |
| Jobs table | `admin/jobs-table.tsx` | filtered, sorted, paginated, empty, phone cards |
| ColumnChart | `partner/column-chart.tsx` | hover/focus tooltip, partial-period colour, table view |
| ConsoleShell / StudioShell | `console/`, `studio/` | full rail, collapsed rail with tooltips, mobile drawer |

## 6. Site map and page specs

**Public** — `/` in the guide's order:
1. Header (72 px): wordmark 168 px, nav ≥ 1024, Sign in / Create; drawer < 1024 listing the three tools by name.
2. Creation stage: eyebrow, h1, sentence (verbatim), composer (layer-stack + glow), curated rail (spheres output · noon→dusk comparison · aurora clip).
3. Featured gallery: 7/5 asymmetric grid — 3:2 lead, two 1:1, one 9:16; every card has "Use this prompt".
4. Prompt-to-result: three tabs; input recipe (prompt, settings table, Use/Copy) beside the output.
5. Use cases: Social, Product, Concepts — scroll-snap row on phones, three columns on desktop, "Start with this idea".
6. Before/after + motion: wide comparison (7 cols) and click-to-play clip (5 cols).
7. Four steps: joined strip with octagonal numerals.
8. Tools and models: three tool columns with capability-named models and availability badges.
9. Pricing: contained split block — how credits work (quote, reserve, settle) + sample packs, flagged "not approved pricing".
10. Partner invitation: proposition without rates; Apply / Preview portal.
11. FAQ: native `<details>` accordion covering cost, delays, failure, privacy, rights.
12. Footer: Create / Company / Policies, status link, preview disclaimer.

**Customer** — rail shell; Overview; Image/Edit/Video studio (360 px settings + canvas; Input/Status/Result tabs < 1024); Library; Credits; Billing; Support.
**Admin** — dark rail + light canvas; Overview; Jobs; Job detail; Payouts. Other §09 screens are listed as "Later".
**Partner** — dark rail + light canvas; Overview; Links; Referrals; Commissions; Payouts; Resources; Settings; public `/partners/apply`.

## 7. Responsive behaviour

| Width | Public | Customer | Admin / partner |
| --- | --- | --- | --- |
| 1440 | Full nav, 3-up rail, 7/5 gallery | 232 px rail, 360 px settings, large canvas | 232 px rail, full tables |
| 1024 | Full nav; gallery keeps columns | 72 px icon rail with tooltips | Rail; tables scroll inside their region |
| 768 | Menu drawer, composer full width, 3-up rail | Drawer; Input/Status/Result tabs | Drawer; filters wrap |
| 390 / 360 | Title, sentence, composer, one featured card | Tabs; sticky Generate above safe area (released while a field is focused) | Record cards; stacked balances; Copy link first |

## 8. Motion storyboard

| Element | Trigger | Property / timing | Reduced motion | Purpose |
| --- | --- | --- | --- | --- |
| Controls | hover / focus | colour, border 150 ms | unchanged (no movement) | affordance |
| Sections (public) | scroll into view | opacity + 14 px translate, CSS scroll-driven (`animation-timeline: view()`) ≈ first 22 % of entry | disabled; content always visible where unsupported | gentle reveal without JS |
| Media cards | hover | 1.03 scale on image 300 ms (library/overview) | disabled | feedback |
| Job phase strip | phase change | colour change; current phase pulses | pulse disabled | real state, no fake % |
| Spinners | busy | rotation | reduced to one iteration | busy feedback |
| Dialogs / drawers | open | native dialog | — | focus-safe |

No count-ups on money, no parallax, no pinned sections, no autoplay.

## 9. Accessibility and performance rules

- Skip link, landmarks, one visible h1 per view, labelled tablists with arrow keys, visible 2 px focus ring (`#A9C1FF` dark / `#1C5DFF` light).
- Status always icon + text; disabled actions explain why next to the control.
- Every chart has values in text or a table view; the column chart has a focusable tooltip per bar.
- Images via `next/image` with fixed ratios; video `preload="none"` + poster; logo exports ≤ 46 KB; concept clip 320 KB; Inter self-hosted.
- `robots: noindex` while the site carries sample data.

## 10. Asset inventory

| Asset | Status | Location |
| --- | --- | --- |
| Logo masters (4) | Supplied | `brand/source/` (not served) |
| Wordmark exports white/dark 480/960 px PNG + WebP | Derived (trim + resize only) | `public/brand/` |
| Symbol 64/512 px, favicon, apple icon | Derived (crop of supplied symbol) | `public/brand/`, `src/app/` |
| Open Graph image | Composed: supplied white logo on `#0B0F1A` + palette bars | `src/app/opengraph-image.png` |
| Concept media (6 stills, 1 clip) | Temporary, procedural (`brand/concept_media.py`) | `public/media/concept/` — replace before launch |
| Validated Genlixs outputs, rights records | Missing | — |
| Legal copy, support contact, pricing, partner terms | Missing | — |

## 11. Handoff decisions

- Figma was not available; the coded components, tokens and screenshots in `screenshots/` are the design source. A Figma rebuild should mirror `src/components` names.
- The single data seam for production is `src/lib/*` — components consume plain props/state, so services can replace the demo store without redesign.
