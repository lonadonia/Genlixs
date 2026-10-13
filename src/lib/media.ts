/**
 * Concept media registry.
 *
 * Every entry is TEMPORARY concept artwork rendered procedurally for this
 * design preview (see brand/concept_media.py). None of it is model output.
 * Design Guide §14: label temporary media and replace it with validated
 * Genlixs generations or licensed content before launch.
 */
export type ConceptMedia = {
  id: string;
  src: string;
  width: number;
  height: number;
  alt: string;
  kind: "image" | "video";
  poster?: string;
};

export const MEDIA = {
  dunesDusk: {
    id: "dunes-dusk",
    src: "/media/concept/dunes-dusk.jpg",
    width: 1600,
    height: 1067,
    alt: "Layered sand dunes under a violet-to-orange dusk sky with a low, pale sun",
    kind: "image",
  },
  dunesNoon: {
    id: "dunes-noon",
    src: "/media/concept/dunes-noon.jpg",
    width: 1600,
    height: 1067,
    alt: "The same dune landscape at midday, with pale sand and a clear blue sky",
    kind: "image",
  },
  spheres: {
    id: "studio-spheres",
    src: "/media/concept/studio-spheres.jpg",
    width: 1600,
    height: 1067,
    alt: "Four glossy spheres in orange, chrome, lime and violet resting on a soft grey studio floor",
    kind: "image",
  },
  product: {
    id: "product-amber",
    src: "/media/concept/product-amber.jpg",
    width: 1200,
    height: 1200,
    alt: "An amber glass bottle with a black cap and blank label on a cream pedestal",
    kind: "image",
  },
  auroraVertical: {
    id: "aurora-vertical",
    src: "/media/concept/aurora-vertical.jpg",
    width: 900,
    height: 1600,
    alt: "Green and violet aurora curtains above a mountain ridge, reflected in a still lake",
    kind: "image",
  },
  auroraClip: {
    id: "aurora-clip",
    src: "/media/concept/aurora-clip.mp4",
    poster: "/media/concept/aurora-clip-poster.jpg",
    width: 1280,
    height: 720,
    alt: "Six-second clip of aurora curtains drifting over dark mountains and a lake",
    kind: "video",
  },
} satisfies Record<string, ConceptMedia>;

export type MediaKey = keyof typeof MEDIA;
