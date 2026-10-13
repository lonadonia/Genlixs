/**
 * Media manifest — the single place visuals come from.
 *
 * Two sources:
 * - `client*` entries: images and one clip supplied by Genlixs in the shared Drive folder,
 *   resized/re-encoded for the web (`public/media/client/`, clip muted). Files carrying a
 *   watermark or a third-party brand mark were left out. Their rights record, generating
 *   model and settings still need confirming before launch (design guide §14).
 * - the remaining entries: TEMPORARY placeholders rendered procedurally for the preview
 *   (brand/concept_media.py, brand/placeholder_renders.py). None of it is model output; they
 *   stay only where no client file fits (the abstract brand loop, the same-scene edit pair).
 *   Replace `src` (and `poster`), set `placeholder: false` and fill `credit` when approved
 *   media arrive.
 */
export type MediaItem = {
  id: string;
  src: string;
  width: number;
  height: number;
  alt: string;
  kind: "image" | "video";
  poster?: string;
  /** Seconds, for video. */
  duration?: number;
  placeholder: boolean;
  credit?: string;
};

const CLIENT_CREDIT = "Client-supplied (Genlixs Drive) — rights and model record to confirm";

export const MEDIA = {
  torus: {
    id: "v2-torus",
    src: "/media/concept/v2-torus.jpg",
    width: 1200,
    height: 1500,
    alt: "Electric-blue torus with a lime sphere floating through its centre on a dark studio floor",
    kind: "image",
    placeholder: true,
  },
  pills: {
    id: "v2-pills",
    src: "/media/concept/v2-pills.jpg",
    width: 900,
    height: 1600,
    alt: "Three glossy capsules in lime, electric blue and white standing on a dark floor",
    kind: "image",
    placeholder: true,
  },
  orbs: {
    id: "v2-orbs",
    src: "/media/concept/v2-orbs.jpg",
    width: 1600,
    height: 1067,
    alt: "Lime, chrome, blue and white spheres with a white ring resting on a dark studio floor",
    kind: "image",
    placeholder: true,
  },
  loop: {
    id: "v2-loop",
    src: "/media/concept/v2-loop.mp4",
    poster: "/media/concept/v2-loop-poster.jpg",
    width: 960,
    height: 540,
    alt: "Five-second loop of a rotating electric-blue torus with an orbiting lime sphere",
    kind: "video",
    duration: 5,
    placeholder: true,
  },
  dunesDusk: {
    id: "dunes-dusk",
    src: "/media/concept/dunes-dusk.jpg",
    width: 1600,
    height: 1067,
    alt: "Layered sand dunes under a violet-to-orange dusk sky with a low, pale sun",
    kind: "image",
    placeholder: true,
  },
  dunesNoon: {
    id: "dunes-noon",
    src: "/media/concept/dunes-noon.jpg",
    width: 1600,
    height: 1067,
    alt: "The same dune landscape at midday, with pale sand and a clear blue sky",
    kind: "image",
    placeholder: true,
  },
  spheres: {
    id: "studio-spheres",
    src: "/media/concept/studio-spheres.jpg",
    width: 1600,
    height: 1067,
    alt: "Four glossy spheres in orange, chrome, lime and violet resting on a soft grey studio floor",
    kind: "image",
    placeholder: true,
  },
  product: {
    id: "product-amber",
    src: "/media/concept/product-amber.jpg",
    width: 1200,
    height: 1200,
    alt: "An amber glass bottle with a black cap and blank label on a cream pedestal",
    kind: "image",
    placeholder: true,
  },
  auroraVertical: {
    id: "aurora-vertical",
    src: "/media/concept/aurora-vertical.jpg",
    width: 900,
    height: 1600,
    alt: "Green and violet aurora curtains above a mountain ridge, reflected in a still lake",
    kind: "image",
    placeholder: true,
  },
  auroraClip: {
    id: "aurora-clip",
    src: "/media/concept/aurora-clip.mp4",
    poster: "/media/concept/aurora-clip-poster.jpg",
    width: 1280,
    height: 720,
    alt: "Six-second clip of aurora curtains drifting over dark mountains and a lake",
    kind: "video",
    duration: 6,
    placeholder: true,
  },

  /* Client-supplied media (Genlixs Drive) */
  forestFlare: {
    id: "client-forest-flare",
    src: "/media/client/forest-flare.webp",
    width: 1195,
    height: 1600,
    alt: "Two hooded figures face each other in a misty forest at dusk, one holding a burning red flare",
    kind: "image",
    placeholder: false,
    credit: CLIENT_CREDIT,
  },
  seaGown: {
    id: "client-sea-gown",
    src: "/media/client/sea-gown.webp",
    width: 1289,
    height: 1600,
    alt: "A woman in a silver sequin gown with a long train stands on a dark beach at blue hour, an island on the horizon",
    kind: "image",
    placeholder: false,
    credit: CLIENT_CREDIT,
  },
  milkyTent: {
    id: "client-milky-tent",
    src: "/media/client/milky-tent.webp",
    width: 1289,
    height: 1600,
    alt: "A glowing tent pitched on frosty rocks beneath the Milky Way",
    kind: "image",
    placeholder: false,
    credit: CLIENT_CREDIT,
  },
  summitBag: {
    id: "client-summit-bag",
    src: "/media/client/summit-bag.webp",
    width: 1289,
    height: 1600,
    alt: "A red and green down sleeping bag on a foam mat at a snowy mountain summit at sunrise",
    kind: "image",
    placeholder: false,
    credit: CLIENT_CREDIT,
  },
  library: {
    id: "client-library",
    src: "/media/client/library.webp",
    width: 1195,
    height: 1600,
    alt: "A dark wood-panelled study with painted wallpaper, a leather armchair and soft window light",
    kind: "image",
    placeholder: false,
    credit: CLIENT_CREDIT,
  },
  boardwalk: {
    id: "client-boardwalk",
    src: "/media/client/boardwalk.webp",
    width: 1197,
    height: 1600,
    alt: "A woman in sunglasses and a black lace top looks back over her shoulder on a beach boardwalk under a clear sky",
    kind: "image",
    placeholder: false,
    credit: CLIENT_CREDIT,
  },
  garden: {
    id: "client-garden",
    src: "/media/client/garden.webp",
    width: 900,
    height: 1600,
    alt: "A red-haired woman in a white cotton dress with a leather crossbody bag stands in a rose garden",
    kind: "image",
    placeholder: false,
    credit: CLIENT_CREDIT,
  },
  stoneHall: {
    id: "client-stone-hall",
    src: "/media/client/stone-hall.webp",
    width: 893,
    height: 1600,
    alt: "A woman in a pale yellow slip dress stands by a stone column in a warm, lamp-lit interior",
    kind: "image",
    placeholder: false,
    credit: CLIENT_CREDIT,
  },
  horned: {
    id: "client-horned",
    src: "/media/client/horned.webp",
    width: 1067,
    height: 1600,
    alt: "Studio portrait of a pale character with four green eyes, red horns and a glossy black collar on deep blue",
    kind: "image",
    placeholder: false,
    credit: CLIENT_CREDIT,
  },
  trench: {
    id: "client-trench",
    src: "/media/client/trench.webp",
    width: 1067,
    height: 1600,
    alt: "A young woman in an olive trench coat, hair blowing across her face, against a muted green wall",
    kind: "image",
    placeholder: false,
    credit: CLIENT_CREDIT,
  },
  earring: {
    id: "client-earring",
    src: "/media/client/earring.webp",
    width: 1600,
    height: 1280,
    alt: "Close-up of a woman with tousled dark hair wearing a sculptural gold earring and a black turtleneck",
    kind: "image",
    placeholder: false,
    credit: CLIENT_CREDIT,
  },
  warriorSheet: {
    id: "client-warrior-sheet",
    src: "/media/client/warrior-sheet.webp",
    width: 1600,
    height: 884,
    alt: "Character sheet of an armoured warrior with a spear and quiver, shown from the front, side and back",
    kind: "image",
    placeholder: false,
    credit: CLIENT_CREDIT,
  },
  driveThru: {
    id: "client-drive-thru",
    src: "/media/client/drive-thru.webp",
    width: 1600,
    height: 900,
    alt: "A witch-themed drive-thru at night under a neon cauldron sign; a server in a navy uniform hands a green drink to a driver",
    kind: "image",
    placeholder: false,
    credit: CLIENT_CREDIT,
  },
  sofa: {
    id: "client-sofa",
    src: "/media/client/sofa.webp",
    width: 900,
    height: 1600,
    alt: "A man with glasses and an olive overshirt scrolls his phone on a brown leather sofa by a window",
    kind: "image",
    placeholder: false,
    credit: CLIENT_CREDIT,
  },
  knightClip: {
    id: "client-knight-clip",
    src: "/media/client/knight-clip.mp4",
    poster: "/media/client/knight-clip-poster.webp",
    width: 752,
    height: 560,
    alt: "Nine-second clip: a wolf pup in silver armour holds a sword in a foggy meadow, then an armoured knight appears behind it",
    kind: "video",
    duration: 9,
    placeholder: false,
    credit: CLIENT_CREDIT,
  },
} satisfies Record<string, MediaItem>;

export type MediaKey = keyof typeof MEDIA;
/** Back-compat alias for earlier components. */
export type ConceptMedia = MediaItem;

export const stillOf = (key: MediaKey) => {
  const m: MediaItem = MEDIA[key];
  return m.kind === "video" ? m.poster! : m.src;
};
