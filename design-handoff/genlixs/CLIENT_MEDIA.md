# Client media record — Genlixs Drive (REQ-063) and local hand-over (REQ-067)

## v3.4 — How it works, demo clips, Motion Library and the new logo (17–18 Oct 2026)

Sources (on the owner's computer, untouched; derivatives only): `Videos/Create Video how it work` (7), `Videos/demo videos`
(5), `Videos/EXPLORS` (32), `Videos/EXPLORS 2` (27) and `Brand/Website-header-logo.png`. Every clip was screened on
contact sheets (5–10 frames), probed with ffprobe and checked for duplicates by SHA-256; continuity was measured with
ffmpeg scene detection (`select='gt(scene,0.32)'`). No creator, prompt or model was supplied with any file, so none is
shown.

**Processing:** wide clips `scale='min(960,iw)':-2, fps=24, libx264 high CRF 24 (maxrate 2400k), AAC 128k, faststart`,
poster WebP q80 at a chosen frame, 240 px thumbnail; portrait clips use the v2.2 recipe above (540 px, CRF 26, AAC 96k).
New files: 7 walkthroughs (16.6 MB), 2 demos (6.3 MB), 3 portrait clips (3.9 MB).

### Walkthroughs — video studio › How it works (`src/lib/tutorials.ts`)

| File | Source | Length | Shown as |
| --- | --- | --- | --- |
| `tutorials/scene-ride.mp4` | `main video.mp4` | 8 s | One ride, many versions (wipe between versions of one ride) |
| `tutorials/fire-sorceress.mp4` | `dds.mp4` (= `demo videos/ddss.mp4`) | 15 s | An action scene, beat by beat |
| `tutorials/shop-crash.mp4` | `sdsd.mp4` (= `demo videos/sdsd.mp4`) | 11 s | Stunts and falling debris |
| `tutorials/gummy-spot.mp4` | `sdss.mp4` | 9 s | A product spot in seconds |
| `tutorials/wafer-ad.mp4` | `ssd.mp4` | 12 s | Style changes inside one ad |
| `tutorials/edit-character.mp4` | `edit.mp4` | 11 s | Edit Video: replace a character (split-screen) |
| `tutorials/edit-car.mp4` | `edit (1).mp4` | 24 s | Edit Video: change one detail everywhere (split-screen) |

### Demo clips — sign-in page and the landing page "Video" section (`demoNightMarket`, `demoArmorAlley`)

| File | Source | Use |
| --- | --- | --- |
| `demos/night-market.mp4` | `sd.mp4` | Sign-in brand panel (muted loop, poster under reduced motion / Save-Data) and the landing reel |
| `demos/armor-alley.mp4` | `sddsd.mp4` | Landing reel |
| — | `ddss.mp4`, `sdsd.mp4` | Duplicates of two walkthroughs (same bytes); used there |
| — | `ds.mp4` | **Excluded:** carries a sportswear brand's slogan ("JUST DO IT.") as on-screen text |

### Motion Library — video studio (`src/lib/motion-library.ts`, 9 clips)

Selection rule: a clip must be usable as the motion reference of Kling 3.0 Motion Control — one performer whose head,
shoulders and torso stay visible, one continuous shot, 3–30 s, within the model's size and shape limits (docs.kie.ai,
re-read 18 Oct 2026). Animals, crowds, cut sequences and product or vehicle clips were left out: they cannot be checked
against that requirement without a paid run.

| Library clip | File | Source | Length |
| --- | --- | --- | --- |
| Pink pyjama dance | `client/pajama-dance.mp4` | EXPLORS `generation (14)` | 17.0 s |
| Doorway dance | `client/doorway-dance.mp4` | EXPLORS `generation (31)` | 10.0 s |
| Oversized-tee dance | `client/tee-dance.mp4` | EXPLORS 2 `generation (8)` | 8.0 s |
| Rollers to waves | `client/hair-rollers.mp4` | EXPLORS 2 `generation (20)` | 14.0 s |
| Studio session | `client/studio-session-solo.mp4` | EXPLORS 2 `generation (3)`, **excerpt 11.45–16.35 s** | 4.9 s |
| Leather coat, red brick | `client/leather-coat.mp4` | EXPLORS 2 `generation (14)` | 10.1 s |
| Pink knit, suede tote | `client/pink-knit-walk.mp4` | EXPLORS 2 `generation (22)` | 15.0 s |
| Tote by the arches | `client/arcade-tote.mp4` | EXPLORS 2 `generation (4)` | 15.0 s |
| Money shot | `client/cash-fan.mp4` | EXPLORS 2 `generation (13)` | 15.0 s |

`studio-duo.mp4` (30.04 s, the full "Studio session" on the homepage wall) is over the 30 s motion limit and is a music-video
edit with 12 cuts between two performers. The library uses a separate excerpt: the longest single-performer shot,
4.917 s (ffprobe), 0 cuts; the source and the homepage clip are unchanged.

**Not in the library** (EXPLORS 2 clips stay on the homepage wall as before):

| Reason | Files |
| --- | --- |
| Cut sequence (2–12 cuts) | EXPLORS `(5)`, `(9)`, `(11)`, `(12)`, `(19)`, `(21)`, `(26)`; EXPLORS 2 `(1)`, `(7)`, `(9)`, `(17)`, `(23)`, `(26)`, `(18)` |
| Animal performers | EXPLORS `(7)`, `(13)`, `(17)`, `(23)`; EXPLORS 2 `(12)`, `(16)`, `(19)`, `(21)`, `(24)` |
| Several performers or a crowd | EXPLORS `(8)`, `(16)`, `(29)` |
| Head not in frame | EXPLORS 2 `(11)` |
| Performer leaves the frame | EXPLORS `(15)` |
| Product, vehicle or brand mark | EXPLORS `DD.mp4`, `DDSSDSD.mp4`, `(4)`, `(6)`, `(10)`, `(18)`, `(20)`, `(22)`, `(24)`, `(27)`, `(28)`, `(30)`, `(32)`; EXPLORS 2 `(2)`, `(6)`, `(10)`, `(15)`, `(25)` |
| No performer | EXPLORS 2 `(5)`, `generation.mp4` |
| Resembles a third-party cartoon character | EXPLORS `DDD.mp4` |
| Duplicate | EXPLORS `(25)` = EXPLORS 2 `(24)` |

### Logo

`Brand/Website-header-logo.png` (20171×4487, opaque on rgb(16,18,17)): transparency taken from the near-black field,
trimmed to 2068×413 (5.007:1), nothing recoloured. `public/brand/genlixs-header-v3-1440.png` is the header, studio and
sign-in wordmark (`Logo`, served through `next/image`); `genlixs-header-v3-960.png` is the partner-resources download.
The favicon is unchanged (not requested).

## v2.2 — local hand-over of the full folders (14 Oct 2026)

The client placed the complete `images` (71 files, renamed `Image_1…71`) and `Videos` (27 files, `generation (N).mp4`) folders next to the project. Every file was screened on contact sheets (each image; 4 frames per clip), with zoomed crops on any label, logo or text. The Drive section further down records the earlier v2.1 round; its 14 images and the knight clip are among the 71 / 27 files and stay in use.

**Processing** (sharp and ffmpeg 6.1, run outside the repo):
- Images: longest side 1600 px, WebP quality 78 (effort 6). Each file keeps its own ratio.
- Clips: `ffmpeg -i in.mp4 -map 0:v:0 -map 0:a:0? -vf "scale=540:-2:flags=lanczos,fps=24" -c:v libx264 -preset slow -crf 26 -maxrate 1600k -bufsize 3200k -profile:v high -pix_fmt yuv420p -g 48 -c:a aac -b:a 96k -ac 2 -movflags +faststart out.mp4`. The knight clip keeps 752×560. **The sound track is kept** (the client wants visitors to be able to turn it on); every clip still starts muted. Posters: frame at 0.8 s, WebP quality 80.
- Result: 21 clips, 0.6–3.4 MB each (38 MB), 50 images; `public/media/client/` is 45 MB in total.

### Clips used (21)

| Key | File | Source | Length | Sound |
| --- | --- | --- | --- | --- |
| `outfitFlatlay` | `outfit-flatlay.mp4` | `generation.mp4` | 13 s | yes |
| `streetStyle` | `street-style.mp4` | `generation (1).mp4` | 13 s | no track |
| `studioDuo` | `studio-duo.mp4` | `generation (3).mp4` | 30 s | yes |
| `arcadeTote` | `arcade-tote.mp4` | `generation (4).mp4` | 15 s | yes |
| `abayaLookbook` | `abaya-lookbook.mp4` | `generation (7).mp4` | 13 s | no track |
| `teeDance` | `tee-dance.mp4` | `generation (8).mp4` | 8 s | yes |
| `goldenHourWalk` | `golden-hour-walk.mp4` | `generation (9).mp4` | 11 s | yes |
| `shoppingBags` | `shopping-bags.mp4` | `generation (11).mp4` | 8 s | yes |
| `poodleDance` | `poodle-dance.mp4` | `generation (12).mp4` | 20 s | yes |
| `cashFan` | `cash-fan.mp4` | `generation (13).mp4` | 15 s | yes |
| `leatherCoat` | `leather-coat.mp4` | `generation (14).mp4` | 10 s | yes |
| `catPhotoshoot` | `cat-photoshoot.mp4` | `generation (16).mp4` | 15 s | yes |
| `streetDuo` | `street-duo.mp4` | `generation (17).mp4` | 13 s | no track |
| `giantAstronaut` | `giant-astronaut.mp4` | `generation (18).mp4` | 10 s | yes |
| `knightClip` | `knight-clip.mp4` | `generation (19).mp4` | 9 s | yes (re-encoded with sound) |
| `hairRollers` | `hair-rollers.mp4` | `generation (20).mp4` | 14 s | yes |
| `catStandoff` | `cat-standoff.mp4` | `generation (21).mp4` | 25 s | yes |
| `pinkKnitWalk` | `pink-knit-walk.mp4` | `generation (22).mp4` | 15 s | yes |
| `glitchDancer` | `glitch-dancer.mp4` | `generation (23).mp4` | 12 s | yes |
| `alleyCats` | `alley-cats.mp4` | `generation (24).mp4` | 15 s | yes |
| `patchworkCoat` | `patchwork-coat.mp4` | `generation (26).mp4` | 13 s | no track |

### Clips excluded (6)

| Source | Reason |
| --- | --- |
| `generation (2).mp4` | Race car covered in real sponsor logos (oil, tyre and heating brands) and a car maker's design |
| `generation (5).mp4` | Construction-machine maker's badge on the digger |
| `generation (6).mp4` | Car maker's grille and badge |
| `generation (10).mp4` | Car maker's badge on the boot |
| `generation (15).mp4` | Car maker's badge and model name, plus a promotional wall slogan |
| `generation (25).mp4` | Car maker's badge (sports car) |

### Images added (36)

`panda-poster` (Image_3), `ski-selfie` (4), `gallery-poster` (5), `corgi-chair-ad` (6), `fitting-room-ui` (7), `goggles-ad` (8), `streetwear-poster` (9), `pug-suitcase` (11), `camper-selfie` (14), `elevator-selfie` (19), `foggy-doorway` (20), `fisheye-grin` (23), `beach-pink` (25), `pottery-couple` (31), `spiked-hand` (34), `knight-sheet` (35), `bomber-sunset` (38), `chaos-chore` (40), `coloring-cat` (42), `fig-perfume` (43), `abandoned-store` (44), `caped-knight` (47), `galley-cafe` (48), `matcha-selfie` (50), `shibuya-halloween` (53), `bedroom-editorial` (57), `leopard-back` (58), `cosmic-sphere` (60), `jellyfish-bed` (61), `rooftop-night` (62), `convertible-night` (64), `birthday-beach` (65), `dressing-room` (66), `emperor-selfie` (67), `gold-balloons` (69), `smashed-cake` (70).

Already in use from v2.1: Image_2 (`forest-flare`), 12 (`sea-gown`), 15 (`milky-tent`), 16 (`summit-bag`), 18 (`library`), 21 (`boardwalk`), 22 (`garden`), 27 (`stone-hall`), 36 (`horned`), 46 (`drive-thru`), 52 (`trench`), 56 (`earring`), 63 (`sofa`), 71 (`warrior-sheet`).

The posters and ads (panda, exhibition, furniture, fitting room, goggles, streetwear, perfume) carry brand names that look invented for the image (for example "M. Atelier", "Apex & Summit", "Loud Kids Club", "Fascent"). No match to a known brand was found on review, but the client should confirm none of them is a real company. The spiked hand and the bedroom editorial were held back in v2.1; they are now used, but only on the showcase wall, because the client asked for the folder's images to be on the site.

### Images excluded (21)

| Source | Reason |
| --- | --- |
| Image_1 | Higgsfield watermark |
| Image_10 | Real hair-care brand on the bottles |
| Image_13 | Sportswear maker's logo on the shoes |
| Image_17 | Board maker's logo |
| Image_24 | Real skincare brand on the bottles |
| Image_26 | Maker's emblem on the riding helmet |
| Image_28 | Restaurant chain's storefront sign |
| Image_29 | Car maker's badge |
| Image_30 | Comic-character emblem on the phone case; headphone maker's logo |
| Image_32 | Smoking; film quote and label on the shirt |
| Image_33 | Club-style crest on the shirt |
| Image_37 | Fashion house name in the graffiti |
| Image_39 | Real hair-care brand on the bottle |
| Image_41 | Sportswear maker's stripes on the shoes |
| Image_45 | Real convenience-store brand on the cup |
| Image_49 | Sports team logo on the cap |
| Image_51 | Smoking; school uniform resembling a TV series costume |
| Image_54 | Car maker's badge |
| Image_55 | Car maker's badge |
| Image_59 | Another creator's credit printed on the image ("AI-креатор … Diana B.") |
| Image_68 | Sports team logo on the hoodie |

---

## v2.1 — Drive connector round

Source: the shared Drive folder (`IMAGES` and `VIDEOS` subfolders), fetched on 13–14 Oct 2026 through the Google Drive connector. That connector only returns files of 10 MB or less. Direct `drive.google.com` access is still denied by this environment's network policy, and that denial was not worked around.

Processing: images were resized to 1600 px on the long side and saved as WebP (quality 78) by `brand/client_media.py`. The clip was re-encoded to muted H.264 with faststart (the original had an audio track), and a poster was taken at 1.2 s. Every file keeps its original aspect ratio, and the hero tiles use those ratios directly.

Manifest: `src/lib/media.ts` (`placeholder: false`, `credit: "Client-supplied (Genlixs Drive) — rights and model record to confirm"`).

> **Before launch:** the file names carry an `hf_` prefix, and one file carries a Higgsfield watermark. That suggests the media were generated in a third-party tool. Confirm that tool's licence allows commercial use on the Genlixs site, and record the model and settings for each file (design guide §14). The prompts and settings shown on the site are prompt ideas written to match each file. They are not the recorded prompts, and the site says so under the gallery and on the Help page.

## Used (14 images + 1 clip, 2.6 MB in total)

| Key | File | Size | Drive source | Where it appears |
| --- | --- | --- | --- | --- |
| `forestFlare` | `forest-flare.webp` | 1195×1600 | `82e86e0d-…_min.webp` | Hero, gallery |
| `seaGown` | `sea-gown.webp` | 1289×1600 | `hf_20260609_061137_fe919aa0…` | Hero, gallery, sign-in panel |
| `milkyTent` | `milky-tent.webp` | 1289×1600 | `hf_20260715_152206_44ae4a3b…` | Hero, gallery, studio Credits promo, failed library job |
| `summitBag` | `summit-bag.webp` | 1289×1600 | `hf_20260718_144834_ab620e90…` | Hero, "Product imagery" use case, library |
| `library` | `library.webp` | 1195×1600 | `hf_20260726_215449_4a62c1ec…` | Hero, expired library job |
| `boardwalk` | `boardwalk.webp` | 1197×1600 | `hf_20260805_090134_c008fe31…` | Hero |
| `garden` | `garden.webp` | 900×1600 | `hf_20260810_094938_87cf70aa…` | Hero, gallery, library |
| `stoneHall` | `stone-hall.webp` | 893×1600 | `hf_20260831_041956_b743de53…` | Hero |
| `horned` | `horned.webp` | 1067×1600 | `hf_20260919_001431_fabb4274…` | Hero, "Characters and concepts" use case |
| `trench` | `trench.webp` | 1067×1600 | `hf_20261007_113747_cde2c409…` | Hero, electric band (duotone) |
| `earring` | `earring.webp` | 1600×1280 | `hf_20261008_130122_38b13fe8…` | Hero, gallery |
| `warriorSheet` | `warrior-sheet.webp` | 1600×884 | `hf_20261013_123402_82e0c44d…` | Hero, gallery |
| `driveThru` | `drive-thru.webp` | 1600×900 | `hf_20261002_014222_2fffeb2c….png` | Hero, curated rail, gallery, story tab, Image tool card, library |
| `sofa` | `sofa.webp` | 900×1600 | `hf_20261010_121945_b6e9ad37….png` | "Social posts" use case |
| `knightClip` | `knight-clip.mp4` + poster | 752×560, 9 s, muted, 470 KB | `generation (19).mp4` (4.2 MB, had audio) | Hero (decorative), curated rail, gallery hover preview, story tab, Edit-and-motion, Video tool card, closing band, studio promo, library |

## Downloaded but not used

| Drive file | Reason |
| --- | --- |
| `819ea264-…_min.webp` (mirror selfie) | Higgsfield watermark (third-party branding) |
| `hf_20260920_090239_40e0cd87…` (graffiti portrait) | "BALENCIAGA" lettering |
| `hf_20260721_193200_bed6d674…` (paddleboard) | Board maker's logo |
| `hf_20260817_125839_e368defd…` (skincare bottles) | Real brand name on the labels |
| `hf_20260905_153948_a720099d…` (villa + sports car) | Car maker's badge |
| `hf_20261008_080430_31411ff9…` (SUV in hangar) | Car maker's badge |
| `hf_20260924_092904_f1b55216…` (cosmetic + peaches) | Product brand name on the label |
| `hf_20260916_190406_20c9a263…` (boy with lizard) | Club-style crest on the shirt |
| `hf_20261007_041320_29fbfc59…` (courtyard portrait) | Shows smoking |
| `hf_20261008_131025_d0cfa317…` (bedroom editorial) | Held back for client review (styling) |
| `hf_20260831_160307_f7145710….png` (billboard + can) | Real restaurant chain's storefront sign |
| `hf_20261001_134608_064c4555….png` (desk, New Year) | Real brand on the cup |
| `hf_20260930_005022_c5f50df3….png` (culottes) | Sportswear maker's stripes on the shoes |
| `hf_20260916_231254_3b8df41d….png` (spiked hand) | Held back: unsettling for a homepage; can be used on request |

## Not fetched

| Files | Reason |
| --- | --- |
| 26 of 27 videos (12–43 MB each) | Over the connector's 10 MB limit |
| 9 PNGs over 10 MB | Over the connector's 10 MB limit |
| 2 PNGs (8.5 MB, 6.6 MB) | Connector closed the connection (message too large) |
| About 31 other PNGs of 10 MB or less | Not requested this round; the 25 fetched files already cover the layouts |

To bring in the remaining videos, do one of the following:
- compress each one under 10 MB (for example 720p H.264 at about 2–3 Mb/s, audio removed) in the same Drive folder; or
- allow `drive.google.com`, `drive.usercontent.google.com` and `*.googleusercontent.com` in the environment's **Network access** setting.

Each new file is then one entry in `src/lib/media.ts`. Components need no changes.
