/**
 * "How it works" walkthrough videos for the video studio: the client's "Create Video how it work" clips (17 Oct 2026),
 * re-encoded for the web (960×540 H.264 + AAC, sources untouched). Titles and notes describe what each clip shows; they
 * make no claim about the model or prompt that produced it (none was supplied). The tips point at controls the studio
 * really has.
 */
export type Tutorial = {
  id: string;
  /** Workflow the clip illustrates. */
  eyebrow: "Create Video" | "Edit Video";
  title: string;
  body: string;
  src: string;
  poster: string;
  thumb: string;
  /** Seconds. */
  duration: number;
  alt: string;
};

const clip = (id: string, duration: number, t: Omit<Tutorial, "id" | "src" | "poster" | "thumb" | "duration">): Tutorial => ({
  id,
  src: `/media/tutorials/${id}.mp4`,
  poster: `/media/tutorials/${id}-poster.webp`,
  thumb: `/media/tutorials/${id}-thumb.webp`,
  duration,
  ...t,
});

export const TUTORIALS: Tutorial[] = [
  clip("scene-ride", 8, {
    eyebrow: "Edit Video",
    title: "One ride, many versions",
    body: "A wipe moves between versions of the same roller-coaster ride: the camera move and the riders' timing stay, while the riders and the world change — a seaside pier, a starry sky, a toy-block town.",
    alt: "Split-screen roller-coaster ride: two young riders scream with their arms up as the world around them changes from a seaside pier to a starry sky and a colourful toy-block town",
  }),
  clip("fire-sorceress", 15, {
    eyebrow: "Create Video",
    title: "An action scene, beat by beat",
    body: "A sorceress gathers fire in her hands and blasts a stone gate apart. Describe each beat in order and how the camera moves — a close-up on the hands, then the wide shot of the blast.",
    alt: "A young woman in a red and cream robe conjures fire between her hands in a forest courtyard and blasts a stone gate, which explodes in flames and smoke",
  }),
  clip("shop-crash", 11, {
    eyebrow: "Create Video",
    title: "Stunts and falling debris",
    body: "A woman crashes through the ceiling of a cluttered shop and lands among the wreckage. Say what breaks, where it falls and how the camera follows the fall.",
    alt: "A red-haired woman in a green coat crashes through the ceiling of a cluttered shop and lands among falling debris",
  }),
  clip("gummy-spot", 9, {
    eyebrow: "Create Video",
    title: "A product spot in seconds",
    body: "Sugar crystals, flying gummy bears and the pack itself. Keep the shot list short; to keep real packaging exact, start the clip from your product photo with a start frame.",
    alt: "Macro shot of sugar crystals, then glossy gummy bears flying around a bag of sour gummies and a final pile of colourful bears",
  }),
  clip("wafer-ad", 12, {
    eyebrow: "Create Video",
    title: "Style changes inside one ad",
    body: "From an illustrated pack to slow-motion chocolate and a pop-art finish. Name each style change in the prompt, in the order it should happen.",
    alt: "A chocolate wafer ad: an illustrated pack, a wafer breaking in slow motion, pieces arranged in a circle and a pop-art finale",
  }),
  clip("edit-character", 11, {
    eyebrow: "Edit Video",
    title: "Replace a character",
    body: "A wipe compares two versions of one clip: the man in the blue suit becomes an older gentleman in a tuxedo and sunglasses, and the cars behind him change, while the sunset car park, the framing and the gestures stay. Add your clip, describe the change and add a reference image.",
    alt: "Split-screen comparison in a car park at sunset: a young man in a blue suit holding a green playing card and an older man in a tuxedo with sunglasses make the same gestures",
  }),
  clip("edit-car", 24, {
    eyebrow: "Edit Video",
    title: "Change one detail everywhere",
    body: "Two versions of the same night drive — a red sports car and a silver one — from the petrol station to the motorway. One written change follows the car through the whole clip.",
    alt: "Split-screen night drive: a red sports car and a silver sports car at a petrol station and on a motorway",
  }),
];
