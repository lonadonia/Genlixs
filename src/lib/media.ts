/**
 * Media manifest — the single place visuals come from.
 *
 * Every entry below is a TEMPORARY placeholder rendered procedurally for the design
 * preview (brand/concept_media.py, brand/placeholder_renders.py). None of it is model
 * output. When the client's approved images and videos are available (the shared
 * Drive folder could not be fetched from the build environment), replace `src`
 * (and `poster` for video), set `placeholder: false`, and fill `credit` with the
 * rights / model / settings record required by the design guide §14.
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
} satisfies Record<string, MediaItem>;

export type MediaKey = keyof typeof MEDIA;
/** Back-compat alias for earlier components. */
export type ConceptMedia = MediaItem;

export const stillOf = (key: MediaKey) => {
  const m: MediaItem = MEDIA[key];
  return m.kind === "video" ? m.poster! : m.src;
};
