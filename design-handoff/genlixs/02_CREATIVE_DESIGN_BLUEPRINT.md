# 02 · Creative design blueprint — Genlixs (brand v2)

v2 supersedes the v1 palette, typography and decoration rules. Behaviour, journeys and data shapes are unchanged from v1. **Client note: the primary colour is Electric Blue `#253FF6`.**

## 1. Experience thesis

> For creators and small businesses who need a usable image, edit or short clip, Genlixs should feel **ready, honest and electric**: a creation console first, every cost shown before it is spent, and bold artwork carrying the visual weight. A visitor should reach a first result without guessing what it will cost or what happened to their credits.

Core tension: the client's reference-led, high-energy look against financial clarity. Resolution:
- Expression lives in typography, glows and media. Every control, cost, status and financial surface keeps quiet, high-contrast styling.
- Electric blue `#253FF6` is the primary colour: every main action, selected state, current-navigation marker and brand field. Lime is a sparing secondary accent: the hero underline, signal dots, success states and the focus ring.

## 2. Direction: "Electric Night"

Built from the client's three reference screenshots (patterns only, see 01 §7) and the v2 brand:

| Layer | Decision |
| --- | --- |
| Canvas | Night `#0F1212` with faint dot field, electric-blue radial glow behind creation areas |
| Type | Archivo Variable at 112 % width, extra-bold, −2 % tracking for display; Inter Variable for UI/body |
| Primary | Electric blue for buttons, selected pill tabs, active navigation, announcement bar, brand band and glows; `#5165F8` tint for accent phrases in headlines and icons on dark |
| Secondary accent | Lime for the hero's drawn underline, eyebrow/status dots, success states and the focus ring |
| Shape | Pill controls (`rounded-full`), 20–32 px panels; hero media tiles keep each file's own ratio with 18 px corners (v2.1 client note: not sharp, not pill-shaped) |
| Media | Client-supplied images and clips (50 images, 21 clips with sound off by default; `public/media/client/`, see `CLIENT_MEDIA.md`) across the site; the abstract orbit loop and the dune edit pair remain procedural placeholders, tagged "Placeholder"; studio results built from client files are tagged "Sample" |
| Motion | Scroll-driven section reveal, media columns drifting in opposite directions, underline draw-on; all stop under reduced motion; pause control on every moving region |

Alternatives considered:
- (a) A light editorial site: rejected because the client references are all dark and electric.
- (b) Lime as the primary action colour (an earlier v2 iteration): replaced at the client's request; lime also fails on white (1.1 : 1).

## 3. Colour tokens and tested contrast

Core colours are client inputs. Neutrals are tinted towards Night, and derived tints exist only for accessibility.

| Token | Value | Role |
| --- | --- | --- |
| `brand-night` | `#0F1212` | Canvas, text on lime |
| `brand-lime` / hover | `#E1FF01` / `#ECFF5C` | Secondary accent: hero underline, signal dots, success, focus ring on dark |
| `brand-blue` / hover | `#253FF6` / `#1E33D6` | **Primary**: buttons, selected tabs, active nav, bands, glows (white text on it); never text on dark |
| `brand-blue-bright` | `#5165F8` | Accent phrases in display headlines and icons on dark (large text / graphics only) |
| `brand-white` | `#FFFFFF` | Text, selected pill tabs |
| `canvas` / `surface` / `raised` / `elevated` | `#0F1212` / `#151919` / `#1B2020` / `#232929` | Dark layers |
| `line` / `line-strong` | `#262C2C` / `#6E7B7B` | Divider / form-control boundary |
| `ink` / `muted` / `subtle` | `#FFFFFF` / `#A3ABAB` / `#7E8888` | Text on dark |
| `link` (derived) | `#A9B4FF` | Small links and info text on dark |
| `orange-on-dark` / `error-on-dark` | `#FFB547` / `#FF7A7A` | Attention / error text on dark |
| `paper` / `sheet` / `rule` / `rule-strong` | `#F4F5F2` / `#FFFFFF` / `#E3E6E1` / `#7A8383` | Light data surfaces |
| `ink-dark` / `muted-dark` | `#0F1212` / `#59615F` | Text on light |
| Semantic light pairs | success `#3F4700/#EFF8C2`, info `#253FF6/#E9ECFE`, warning `#8A4B00/#FFF4E0`, error `#B42318/#FDECEC` | Badges and notices |

Computed WCAG 2.x ratios (this run, opaque pairs; script output kept in QA notes):

| Pair | Ratio | Use |
| --- | --- | --- |
| White / electric blue | 6.73 | Primary button label, announcement bar, selected tabs |
| White / blue hover `#1E33D6` | 8.40 | Primary hover |
| Blue-bright `#5165F8` / night · surface · raised | 4.09 · 3.85 · 3.58 | Display accents, icons (≥ 3 : 1) |
| Blue-bright / blue-glow area (`#161D3A`) | 3.59 | Accent headline over the composer glow |
| Night / lime | 16.59 | Text on lime (badges) |
| White / canvas · surface · raised | 18.82 · 17.72 · 16.48 | Body text |
| Muted / canvas · surface · raised | 8.04 · 7.57 · 7.04 | Secondary text |
| Subtle / canvas · surface · raised | 5.17 · 4.86 · 4.52 | Tertiary text |
| Link tint / canvas · surface | 9.56 · 9.00 | Links on dark |
| Lime / canvas · surface | 16.59 · 15.62 | Focus ring, success text |
| Lime focus ring / electric blue | 5.93 | Focus ring around blue buttons |
| Electric blue / canvas | **2.80** | Never text — fills and glows only |
| Blue / white | 6.73 | Inverse button on the blue band |
| Line-strong / canvas · surface · raised | 4.29 · 4.04 · 3.75 | Input boundaries (≥ 3 : 1) |
| Orange-on-dark / surface | 10.09 | Attention text |
| Error-on-dark / surface | 7.02 | Error text |
| Subtle / elevated | 4.06 | Disabled primary (distinguishable) |
| Ink-dark / paper · white | 17.20 · 18.82 | Data text |
| Muted-dark / white · paper | 6.36 · 5.82 | Data labels |
| Rule-strong / white · paper | 3.89 · 3.55 | Light input boundaries |
| Blue / white · info tint | 6.73 · 5.73 | Links and info badges on light |
| Success · warning · error light pairs | 8.93 · 6.24 · 5.76 | Badges |
| White / `#D63652` | 4.66 | Destructive button |
| Lime / white | **1.13** | Never used on light surfaces |

Text over media (worst case: a pure-white pixel under the overlay):
- 72 % night overlay with white text gives 7.62; this covers tags, closing band and the gallery "Use prompt" chip.
- 95 % caption gradient with white text gives 16.79.

## 4. Typography, spacing, shape

- **Display:** Archivo Variable (`@fontsource-variable/archivo/wdth.css`, OFL 1.1), `font-stretch: 112%`, extra-bold, −0.02em.
  - Hero h1: 40 → 52 → 60 → 48 (1024) → 60 (1280) → 68 px (≥ 1400). The breakpoints keep "Turn your ideas into" on one line, with the accent phrase on its own line from 640 px up.
  - Section h2: 30 → 40 → 48 px, line-height 1.05.
- **UI/body:** Inter Variable, `cv11` `ss01`, body 15–18 px, line-height 1.55. Tabular numerals in tables, ledgers, balances.
- **Spacing:**
  - Public gutters 16 / 24 / 40 px; sections 64–96 px.
  - Containers: hero 1440, sections 1360, composer 880, studio Home 1180.
- **Radii:**
  - Pills for buttons, tabs and chips.
  - Cards 20–24 px, feature panels 28–32 px, console 28 px.
- **Shadows:** an electric-blue under-glow on primary buttons and console actions; pop shadows on menus and dialogs only.

## 5. Component library and states

| Component | File | States |
| --- | --- | --- |
| Button / ButtonLink | `ui/button.tsx` | primary (electric blue on every surface), secondary, ghost, danger, light variants, `outline-on-color`, `inverse`; sizes sm–xl; busy, disabled |
| Badge / ConceptTag | `ui/badge.tsx` | tones with icon + text; "Placeholder" tag with lime dot |
| Dialog, CopyButton, MediaFrame | `ui/` | as v1, restyled |
| AutoplayVideo | `ui/autoplay-video.tsx` | muted loop; plays only when visible, motion allowed, not save-data and region not paused; `decorative` mode is hidden from assistive tech |
| ShowcaseVideo (v2.2) | `ui/showcase-video.tsx` | every public clip: muted loop while on screen → click anywhere on it for sound (pill: "Tap for sound" / "Sound on" with level bars) → one clip audible at a time → offscreen pauses and re-mutes; no sound track = play/pause toggle; reduced motion / Save-Data = poster until pressed; `compact` pill for hero tiles; `focusable={false}` for marquee copies |
| ShowcaseWall (v2.2) | `public/showcase-wall.tsx` | masonry of all 71 client items at their own ratio; filter pills All / Videos / Images with counts; first 24, then "Show all"; clip duration chip; caption on hover/focus |
| MotionRegion | `motion-region.tsx` | visible Pause/Play for a moving region (WCAG 2.2.2); hover/focus pause. Used by the closing band; removed from the hero at the client's request (v2.2) |
| Hero | `public/hero.tsx` | headline + underline draw, CTAs, features, `MediaTile` columns (desktop: four columns, `aspect-ratio` from the manifest, clips via `ShowcaseVideo`, run to the viewport's right edge) / strip (phones: 176 px tall, width from the ratio); no Pause/Play button (v2.2) |
| Composer (public) | `public/composer.tsx` | pill tabs (arrow keys), example-loaded notice, "+" reference tile (Edit), chip selects, counter, guest/authed action, prompt ideas |
| QuickCreate (studio Home) | `studio/overview.tsx` | same draft; quality/length chips; exact cost + round Generate; edit routes to the edit studio; prompt error; insufficient credits with top-up link |
| StudioShell | `studio/studio-shell.tsx` | floating rail (236 / 72 px), tooltips, groups, New creation, balance card, icon row; header switch, credits, Top up, notifications, account; drawer < 1024 |
| Workspace, controls, JobStatus, results, uploader, library, credits | `studio/*` | as v1 behaviour; blue selection, blue pill segments, blue switch, rounded panels |
| ConsoleShell (admin/partner) | `console/console-shell.tsx` | night rail with blue active tint and marker, light canvas, white panels, blue primary |

## 6. Site map and page specs

**Public `/`** (guide order kept; v2 additions in italics):
1. Header 76 px under a blue announcement bar: wordmark 150 px, pill nav ≥ 1024, Sign in, blue Create; drawer < 1024.
2. Creation stage:
   - Hero: eyebrow pill, h1 + underline, sentence, two CTAs, three features, four media columns mixing stills and muted clips (each tile at its file's ratio, 18 px corners; click a clip for sound).
   - Composer section `#create`: "What will you make today?", lit composer, prompt ideas, curated rail (torus output, noon→dusk comparison, orbit loop).
3. Featured gallery `#examples`: 4-column dense bento (two tall, several wide), hover/touch "Use prompt", clip cards play muted on screen with click-for-sound.
3b. Showcase wall `#showcase` (v2.2): "Stills and clips, all in motion.", filter pills, masonry of every client image and clip.
4. Prompt-to-result: pill tabs (orbs image, dune edit, orbit loop), input recipe beside the output.
5. Use cases: three tall cards with starter prompts (scroll-snap row on phones).
6. Before/after + motion: blue-handled comparison slider + autoplaying clip with click-for-sound.
7. Four steps: outlined numerals, blue final step.
8. *Electric band: blue panel, "Your next post starts with one sentence.", white inverse CTA + outline.*
9. Tools and models `#tools`: three tool cards with media headers and model rows.
10. Pricing: split — quote/reserve/settle steps + sample packs (flagged).
11. Partner invitation: split panel with four facts.
12. FAQ: card accordions with a blue plus/close.
13. *Closing band: muted orbit loop under a 72 % overlay, "Start with a sentence.", CTAs, pause control.*
14. Footer with brand rule and oversized mono wordmark watermark.

**Info pages** (help, status, terms/privacy/acceptable use, partner application): eyebrow pill, display h1, glow header, rounded panels. **Sign-in:** split layout with a placeholder brand panel on desktop.

**Customer studio:** floating rail; Home (reference dashboard layout) → tool studios (380 px settings panel + canvas) → Library, Credits, Billing, Support.

**Admin / partner:** night rail + light data canvas (unchanged behaviour).

## 7. Responsive behaviour

| Width | Public | Customer | Admin / partner |
| --- | --- | --- | --- |
| 1440 | Two-column hero with media columns; 4-col bento | 236 px floating rail, 380 px settings, canvas | 232 px rail, full tables |
| 1024 | Hero columns narrower (h1 48 px) | 72 px icon rail with tooltips | Rail; tables scroll in region |
| 768 | Single-column hero, media strip, menu drawer | Drawer; Input/Status/Result pill tabs | Drawer; filters wrap |
| 390 / 360 | h1 40 px, accent wraps with underline under "videos.", 2-col gallery with caption action | Tabs; sticky Generate above safe area | Record cards; stacked balances |

## 8. Motion storyboard

| Element | Trigger | Property / timing | Reduced motion | Purpose |
| --- | --- | --- | --- | --- |
| Controls | hover / focus | colour, border 150 ms | unchanged | affordance |
| Sections | scroll | opacity + 14 px, CSS `animation-timeline: view()` | disabled | reveal without JS |
| Hero underline | load | stroke draw 900 ms after 250 ms | shown static | signature accent |
| Media columns / phone strip | continuous | translateY / translateX loop 54–68 s (margins, not gaps, so the −50 % loop is seamless) | stopped | living gallery |
| Media cards | hover | image scale 1.04 over 500–700 ms | disabled | feedback |
| Clips (site-wide, v2.2) | on screen | muted loop; click turns sound on, one clip audible at a time; offscreen pauses + re-mutes | poster until pressed | showcase |
| Closing band loop | in view | muted playback | poster only | atmosphere |
| Job phases, spinners, dialogs | as v1 | as v1 | as v1 | real state |

Moving regions have a visible Pause control, except the hero columns and phone strip: the client asked for that button to be removed (v2.2), so hover/focus pause them and reduced motion stops them. Sound plays only after a click on a clip. There are no count-ups or parallax.

## 9. Accessibility and performance rules

- Skip link, landmarks, one h1 per view, labelled tablists with arrow keys, 2 px focus ring (lime on dark, electric blue on light).
- Borderless text areas inside the lit console are identified by a visible label. The console frame turns blue-bright `#5165F8` on focus (≥ 3.5 : 1) with a stronger glow.
- Selects and chips show a pill-shaped focus ring via `:has(:focus-visible)`.
- Decorative video is `aria-hidden`; meaningful clips keep native controls.
- Media budget:
  - The hero uses one 61 KB loop; v2 stills are 125–151 KB JPEGs; videos use `preload="none"`.
  - Logo exports are ≤ 53 KB; the display font is subset by `@fontsource`.
- `robots: noindex` stays while the site carries sample data and placeholders.

## 10. Asset inventory

| Asset | Status | Location |
| --- | --- | --- |
| Logo v2 masters (4) | Supplied | `brand/source/` (not served) |
| Logo exports: header / color / dark / mono at 480/960 px (PNG + WebP); symbols (tile, color); favicon, icon, apple icon, OG | Derived (colour-to-alpha, trim, resize) | `public/brand/`, `src/app/` |
| v2 placeholder stills (torus 1200×1500, capsules 900×1600, orbs 1600×1067) and orbit loop (960×540, 5 s, 61 KB) + poster | Temporary, procedural (`brand/placeholder_renders.py`) | `public/media/concept/v2-*` |
| v1 concept media (dunes, spheres, product, aurora still + clip) | Temporary, procedural (`brand/concept_media.py`) | `public/media/concept/` |
| Client images (50 used) + 21 clips (540×960 H.264 + AAC 96 kb/s, faststart, 8–30 s, 0.6–3.4 MB, 38 MB in total; the knight clip stays 752×560) + WebP posters | Client-supplied; images resized to 1600 px WebP q78, clips re-encoded with sound (commands in `CLIENT_MEDIA.md`); rights/model record to confirm | `public/media/client/`, record in `CLIENT_MEDIA.md` |
| 26 Drive videos (12–43 MB) and 9 large PNGs | **Not fetched** (connector 10 MB cap; direct Drive access denied) | — compress under 10 MB or allow Drive in network access |
| Validated outputs, rights records, legal copy, pricing, partner terms | Missing | — |

## 11. Handoff decisions

- Media now flows through one manifest, `src/lib/media.ts`. Replacing a file means changing `src`/`poster`, setting `placeholder: false` and adding `credit`; components need no edits.
- The data seam for production is still `src/lib/*`.
- Figma was not available; the coded components, tokens and `screenshots/` are the design source.
