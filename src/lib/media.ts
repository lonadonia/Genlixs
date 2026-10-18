/**
 * Media manifest — the single place visuals come from.
 *
 * Two sources:
 * - `client*` entries: images and clips supplied by Genlixs (Drive folder and the local
 *   `images` / `Videos` hand-over), resized/re-encoded for the web (`public/media/client/`).
 *   Clips keep their sound track (`audio: true`) so visitors can turn it on; they always start
 *   muted. Files carrying a watermark, a creator credit or a third-party brand mark were left
 *   out (design-handoff/genlixs/CLIENT_MEDIA.md). Their rights record, generating model and
 *   settings still need confirming before launch (design guide §14).
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
  /** Video only: the file has a sound track the visitor can turn on. */
  audio?: boolean;
  /** Short caption for showcase cards. */
  title?: string;
  placeholder: boolean;
  credit?: string;
};

const CLIENT_CREDIT = "Client-supplied (Genlixs Drive) — rights and model record to confirm";

const clientImage = (file: string, width: number, height: number, title: string, alt: string): MediaItem => ({
  id: `client-${file}`,
  src: `/media/client/${file}.webp`,
  width,
  height,
  title,
  alt,
  kind: "image",
  placeholder: false,
  credit: CLIENT_CREDIT,
});

/** Wide client clips: 960×540 H.264 + AAC from the "demo videos" and "Create Video how it work" folders (17 Oct 2026). */
const wideClip = (dir: "demos" | "tutorials", file: string, duration: number, title: string, alt: string): MediaItem => ({
  id: `${dir}-${file}`,
  src: `/media/${dir}/${file}.mp4`,
  poster: `/media/${dir}/${file}-poster.webp`,
  width: 960,
  height: 540,
  duration,
  audio: true,
  title,
  alt,
  kind: "video",
  placeholder: false,
  credit: CLIENT_CREDIT,
});

/** Vertical client clips: 540×960 H.264, poster taken at 0.8 s. */
const clientClip = (file: string, duration: number, audio: boolean, title: string, alt: string): MediaItem => ({
  id: `client-${file}`,
  src: `/media/client/${file}.mp4`,
  poster: `/media/client/${file}-poster.webp`,
  width: 540,
  height: 960,
  duration,
  audio,
  title,
  alt,
  kind: "video",
  placeholder: false,
  credit: CLIENT_CREDIT,
});

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
    title: "Red flare in a misty forest",
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
    title: "Sequin gown at blue hour",
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
    title: "Tent under the Milky Way",
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
    title: "Sleeping bag on the summit",
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
    title: "Old-world study",
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
    title: "Boardwalk glance",
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
    title: "Garden portrait",
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
    title: "Lamp-lit stone hall",
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
    title: "Four-eyed character",
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
    title: "Olive trench in the wind",
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
    title: "Gold earring close-up",
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
    title: "Warrior character sheet",
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
    title: "Neon drive-thru",
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
    title: "Candid phone moment",
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
    title: "Pup knight in the fog",
    src: "/media/client/knight-clip.mp4",
    poster: "/media/client/knight-clip-poster.webp",
    width: 752,
    height: 560,
    alt: "Nine-second clip: a wolf pup in silver armour holds a sword in a foggy meadow, then an armoured knight appears behind it",
    kind: "video",
    duration: 9,
    audio: true,
    placeholder: false,
    credit: CLIENT_CREDIT,
  },

  /* Client clips (local hand-over, 14 Oct 2026) */
  outfitFlatlay: clientClip("outfit-flatlay", 13, true, "Outfit flat-lay", "Overhead clip: outfits laid out on a patterned rug change from look to look while a ceiling fan turns above"),
  streetStyle: clientClip("street-style", 13, false, "Street style", "Street-style clip: a young woman in a fur hat and knee boots poses on a cobbled street as the camera whips between looks"),
  studioDuo: clientClip("studio-duo", 30, true, "Studio session", "Two men in black and cream outfits move to music against an orange studio wall beneath a hanging microphone"),
  arcadeTote: clientClip("arcade-tote", 15, true, "Tote by the arches", "A woman in a grey coat and sunglasses swings a tan tote bag in front of tall arched wooden doors"),
  abayaLookbook: clientClip("abaya-lookbook", 13, false, "Abaya lookbook", "Lookbook clip of women in embroidered abayas posing against a seamless beige studio backdrop"),
  teeDance: clientClip("tee-dance", 8, true, "Oversized-tee dance", "A young woman in an oversized graphic T-shirt dances playfully in a bright apartment"),
  goldenHourWalk: clientClip("golden-hour-walk", 11, true, "Golden-hour walk", "A woman in a cream suit walks across an old city square toward a domed church at golden hour"),
  shoppingBags: clientClip("shopping-bags", 8, true, "Shopping-bag stride", "Tracking shot of a woman in white trousers walking with burgundy shopping bags in warm sunlight"),
  poodleDance: clientClip("poodle-dance", 20, true, "Poodle centre stage", "A curly grey poodle in a blue harness stands centre stage while two dancers perform behind it under spotlights"),
  cashFan: clientClip("cash-fan", 15, true, "Money shot", "Low-angle clip of a man in a velvet jacket and tinted glasses fanning stacks of banknotes toward the camera"),
  leatherCoat: clientClip("leather-coat", 10, true, "Leather coat, red brick", "A blonde woman in a long black leather coat and cap poses on a city street in front of red-brick buildings"),
  catPhotoshoot: clientClip("cat-photoshoot", 15, true, "Cat photoshoot", "A cat dances on its hind legs in a hallway while a grey cat films it on a phone"),
  streetDuo: clientClip("street-duo", 13, false, "Street duo", "Street-style clip of two women in denim shorts and wide jeans walking past a concrete building"),
  giantAstronaut: clientClip("giant-astronaut", 10, true, "Giant astronaut in Midtown", "A giant figure in a yellow spacesuit walks between Manhattan towers as people run below and helicopters circle"),
  hairRollers: clientClip("hair-rollers", 14, true, "Rollers to waves", "A woman in pink hair rollers turns, then shakes out glossy blonde waves in a sunlit living room"),
  catStandoff: clientClip("cat-standoff", 25, true, "Cat standoff", "Two cats rise on their hind legs and spar playfully in front of an ivy-covered fence"),
  pinkKnitWalk: clientClip("pink-knit-walk", 15, true, "Pink knit, suede tote", "A woman in a pink knit polo and burgundy trousers swings a suede tote in front of arched doors"),
  glitchDancer: clientClip("glitch-dancer", 12, true, "Glitch dancer", "A masked dancer moves through a parking garage with glitch and colour-split effects"),
  alleyCats: clientClip("alley-cats", 15, true, "Alley-cat crew", "A group of cats dance together on their hind legs in a brick alley with graffiti"),
  patchworkCoat: clientClip("patchwork-coat", 13, false, "Patchwork coat", "A man in a patchwork coat and beret strides down a city street as the camera whips past"),

  /* Client clips (EXPLORS hand-over, 17 Oct 2026) and a single-shot excerpt of "Studio session" for the Motion Library */
  pajamaDance: clientClip("pajama-dance", 17, true, "Pink pyjama dance", "A young woman in pink checked pyjamas dances in a bright bedroom"),
  doorwayDance: clientClip("doorway-dance", 10, true, "Doorway dance", "A young woman in a black sports top and leggings dances in an open white doorway"),
  studioSessionSolo: clientClip("studio-session-solo", 5, true, "Studio session", "A man in a black shirt and silver chains sings and gestures in front of an orange studio wall beside a hanging microphone"),

  /* Demo clips (16:9) */
  demoNightMarket: wideClip("demos", "night-market", 15, "Night market", "At a rainy night market, a young woman sipping bubble tea turns into an ice figure as a huge beast charges through the stalls"),
  demoArmorAlley: wideClip("demos", "armor-alley", 15, "Armour alley", "A blue-haired woman runs through a ruined alley from a red armoured brute as dark armour spreads over her body"),

  /* Client images (local hand-over, 14 Oct 2026) */
  pandaPoster: clientImage("panda-poster", 1600, 1063, "Panda poster", "Vintage Japanese-style poster of a roaring giant panda in cream, teal and red with bold kanji lettering"),
  skiSelfie: clientImage("ski-selfie", 905, 1600, "Mirrored goggles", "A skier in an orange jacket smiles under a black helmet; his mirrored goggles reflect a woman taking a selfie on the slopes"),
  galleryPoster: clientImage("gallery-poster", 1195, 1600, "Exhibition poster", "Risograph-style exhibition poster in red, yellow and black with two stylised portraits and bold type"),
  corgiChairAd: clientImage("corgi-chair-ad", 1195, 1600, "Furniture ad", "Editorial furniture ad: a corgi lounges on a blue leather chair under the headline “Sit Better.”"),
  fittingRoomUi: clientImage("fitting-room-ui", 1600, 905, "Virtual fitting room", "Neon retro game-style interface for a virtual fitting room, with an avatar, an outfit grid and a “Try everything” headline"),
  gogglesAd: clientImage("goggles-ad", 1600, 905, "Smart goggles banner", "Web banner for smart ski goggles: a rider's mirrored lenses reflect a snowboarder mid-jump beside a bold headline"),
  streetwearPoster: clientImage("streetwear-poster", 905, 1600, "Streetwear drop", "Streetwear drop poster: a teen in a navy smiley hoodie holds a lollipop beneath bold yellow “BOOM” lettering"),
  pugSuitcase: clientImage("pug-suitcase", 905, 1600, "Pug on a suitcase", "A pug dressed in a striped top and white trousers lies on a silver suitcase, a beret beside it"),
  camperSelfie: clientImage("camper-selfie", 768, 1376, "Camper-van selfie", "A red-haired young woman in a grey varsity hoodie sips from a red cup inside a camper van"),
  elevatorSelfie: clientImage("elevator-selfie", 1067, 1600, "Lift mirror selfie", "Flash mirror selfie of a young woman in a grey crop top and black shorts in a steel lift"),
  foggyDoorway: clientImage("foggy-doorway", 1067, 1600, "Doorway into fog", "A young woman in a white tank top and black skirt poses in a doorway that opens onto thick night fog"),
  fisheyeGrin: clientImage("fisheye-grin", 1067, 1600, "Fisheye grin", "Fisheye portrait of a curly-haired young woman in red sunglasses grinning down at the camera on a painted court"),
  beachPink: clientImage("beach-pink", 1067, 1600, "Pink on white sand", "A young woman in a pink top and white wrap skirt stands on a white-sand beach by turquoise water"),
  potteryCouple: clientImage("pottery-couple", 1067, 1600, "Pottery studio couple", "A young couple embraces in a pottery studio, shelves of ceramic vases behind them"),
  spikedHand: clientImage("spiked-hand", 1200, 1600, "Spiked sculpture", "Surreal close-up of a fleshy hand-shaped sculpture gripping a spiked chain mace against denim"),
  knightSheet: clientImage("knight-sheet", 1600, 900, "Knight character sheet", "Character sheet of a knight in dark plate armour and a long cape, shown from the front, back and three-quarter view"),
  bomberSunset: clientImage("bomber-sunset", 1195, 1600, "Bomber at sunset", "A curly-haired man in a black beanie and olive bomber jacket stands in a flower field at sunset"),
  chaosChore: clientImage("chaos-chore", 1600, 900, "Laundry-day chaos", "Comic scene: a woman wearing a saucepan as a helmet charges through a smoky kitchen holding laundry and a wooden spoon"),
  coloringCat: clientImage("coloring-cat", 880, 1168, "Colouring page", "Black-and-white colouring-book line drawing of a cat climbing a curtain beside potted plants"),
  figPerfume: clientImage("fig-perfume", 1197, 1600, "Perfume among figs", "A clear perfume bottle lying among halved purple figs and a lime on a dark background"),
  abandonedStore: clientImage("abandoned-store", 900, 1600, "Abandoned store", "A wrecked convenience store with a collapsed ceiling, toppled carts and a figure silhouetted in the doorway"),
  capedKnight: clientImage("caped-knight", 1067, 1600, "Caped knight", "Studio shot of an armoured knight wrapped in a long burgundy fringed cloak on grey"),
  galleyCafe: clientImage("galley-cafe", 1195, 1600, "Galley café", "A narrow, warmly lit café with wood panelling, hanging plants and a small bistro table by the window"),
  matchaSelfie: clientImage("matcha-selfie", 1152, 1536, "Iced matcha selfie", "A young woman in a black hoodie takes a car selfie while sipping an iced matcha latte"),
  shibuyaHalloween: clientImage("shibuya-halloween", 900, 1600, "Halloween in Shibuya", "A woman in a shiba-inu costume hugs a dog statue during a crowded Halloween night in Shibuya"),
  bedroomEditorial: clientImage("bedroom-editorial", 1600, 1280, "Flash editorial", "Flash editorial of a woman in a floral slip dress reclining between a bed and a mustard armchair"),
  leopardBack: clientImage("leopard-back", 1280, 1600, "Leopard print", "A woman in an open-back leopard-print top looks over her shoulder against red tiles"),
  cosmicSphere: clientImage("cosmic-sphere", 905, 1600, "Cosmic sphere", "A man in white linen floats with open arms inside a glowing geodesic sphere among galaxies"),
  jellyfishBed: clientImage("jellyfish-bed", 1200, 1600, "Asleep among jellyfish", "Top-down shot of a woman asleep on a white mattress floating among jellyfish in dark water"),
  rooftopNight: clientImage("rooftop-night", 1200, 1600, "Rooftop at night", "A woman in a camel trench coat sits on a rooftop ledge above a hazy, amber-lit city at night"),
  convertibleNight: clientImage("convertible-night", 1276, 1600, "Night flash", "Flash photo of a young man in sunglasses and a white T-shirt beside an open black convertible at night"),
  birthdayBeach: clientImage("birthday-beach", 900, 1600, "Birthday on the beach", "A young man in a party hat holds a balloon and a rainbow birthday cake on a beach at dusk"),
  dressingRoom: clientImage("dressing-room", 1200, 1600, "Dressing-room mirror", "Mirror selfie of a woman in a burgundy shirt and grey trousers in a dressing room lit by bulb mirror lights"),
  emperorSelfie: clientImage("emperor-selfie", 1024, 1024, "Emperor selfie", "Mirror selfie of a smiling young man dressed as a Roman emperor with a laurel wreath and eagle staff"),
  goldBalloons: clientImage("gold-balloons", 1024, 688, "After the party", "Two flamboyantly dressed men lounge after a party, one in a bathtub full of gold balloons, above a city at dusk"),
  smashedCake: clientImage("smashed-cake", 1600, 1600, "Smashed birthday cake", "A smashed pink birthday cake with gold “50” candles beside a swimming pool"),
} satisfies Record<string, MediaItem>;

export type MediaKey = keyof typeof MEDIA;

/**
 * Order of the homepage showcase wall: client media only, clips spread between stills so every
 * column of the masonry gets motion.
 */
export const SHOWCASE: MediaKey[] = [
  "giantAstronaut", "pandaPoster", "seaGown", "poodleDance", "cosmicSphere", "driveThru", "hairRollers", "jellyfishBed",
  "streetwearPoster", "catPhotoshoot", "forestFlare", "goldenHourWalk", "knightSheet", "pugSuitcase", "glitchDancer",
  "corgiChairAd", "horned", "outfitFlatlay", "skiSelfie", "galleyCafe", "alleyCats", "fittingRoomUi", "leatherCoat",
  "earring", "figPerfume", "studioDuo", "milkyTent", "rooftopNight", "knightClip", "galleryPoster", "teeDance",
  "shibuyaHalloween", "capedKnight", "pinkKnitWalk", "gogglesAd", "fisheyeGrin", "catStandoff", "warriorSheet",
  "emperorSelfie", "shoppingBags", "chaosChore", "summitBag", "cashFan", "abandonedStore", "leopardBack",
  "arcadeTote", "coloringCat", "boardwalk", "abayaLookbook", "bomberSunset", "foggyDoorway", "patchworkCoat",
  "goldBalloons", "garden", "streetStyle", "potteryCouple", "library", "streetDuo", "dressingRoom", "smashedCake",
  "birthdayBeach", "stoneHall", "camperSelfie", "trench", "convertibleNight", "matchaSelfie", "beachPink",
  "elevatorSelfie", "sofa", "bedroomEditorial", "spikedHand",
];
/** Back-compat alias for earlier components. */
export type ConceptMedia = MediaItem;

export const stillOf = (key: MediaKey) => {
  const m: MediaItem = MEDIA[key];
  return m.kind === "video" ? m.poster! : m.src;
};
