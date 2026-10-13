# Client media record — Genlixs Drive (REQ-063)

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
