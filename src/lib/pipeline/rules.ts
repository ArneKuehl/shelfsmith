export const KNOWN_EXTENSIONS = [".epub", ".pdf", ".mobi", ".azw3"] as const;

// ---------------------------------------------------------------------------
// Source suffix rules — ordered longest/most-specific first
// ---------------------------------------------------------------------------

export interface SourceSuffixRule {
  id: string;
  regex: RegExp;
  tag: string | null;
}

export const SOURCE_SUFFIX_RULES: SourceSuffixRule[] = [
  {
    id: "annas_archive",
    regex: /\s*--\s*.+?\s*--\s*\d{4}\s*--\s*.+?\s*--\s*[a-f0-9]{16,}\s*--\s*Anna.?s Archive\s*$/,
    tag: null,
  },
  {
    id: "libgen",
    regex: /\s*-\s*libgen\.li\s*$/,
    tag: null,
  },
  {
    id: "royalroad_rylrdl",
    regex: /-?rylrdl[_-]?\d+\s*$/,
    tag: "royalroad",
  },
  {
    id: "zlibrary",
    regex: /\s*\(Z-Library\)\s*$/,
    tag: null,
  },
  {
    id: "numeric_id",
    regex: /[_-]\d{6,}\s*$/,
    tag: null,
  },
];

// ---------------------------------------------------------------------------
// Inline marker rules
// ---------------------------------------------------------------------------

export interface InlineMarkerRule {
  id: string;
  regex: RegExp;
}

export const INLINE_MARKER_RULES: InlineMarkerRule[] = [
  { id: "epub_marker", regex: /\s*\(epub\)\s*/i },
  { id: "download_duplicate_number", regex: /\s*\(\d{1,2}\)\s*$/ },
  { id: "final_marker", regex: /\s*\(Final\)\s*/i },
  { id: "version_marker", regex: /\s*\((?:v\d[\d.]*|MEAP\s+V\d+)\)\s*/i },
  { id: "auth_marker", regex: /\s*\(auth\.\)\s*/ },
  { id: "author_marker", regex: /\s*\(Author\)\s*/ },
  { id: "us_marker", regex: /\s*\(US\)\s*/ },
  { id: "german_edition_marker", regex: /\s*\(German Edition\)\s*/i },
  { id: "essentials_marker", regex: /\s*\(essentials\)\s*/i },
  { id: "dummies_prefix", regex: /^\([A-Za-z ]+\)\s+/ },
  { id: "leading_bracket_number", regex: /^\[0\]\s+/ },
  { id: "terra_astra_prefix", regex: /^TA\s+\d+\s*-\s*/ },
];

// ---------------------------------------------------------------------------
// Publisher-year block
// ---------------------------------------------------------------------------

// Match "-PublisherName (YYYY...)" at end of string.
// Publisher dashes are NOT preceded by a space (like "-HarperCollins (2016)"),
// unlike author-title separators (" - Title").
export const PUBLISHER_YEAR_REGEX = /(?<!\s)-[^-[\(]+?\s*\(\d{4}[^)]*\)\s*$/;

// Match standalone "(YYYY, Publisher)" at end of string (libgen format).
// E.g. "Author - Title (2020, Albrecht Knaus Verlag)"
export const PAREN_YEAR_PUBLISHER_REGEX = /\s*\(\d{4},\s*[^)]+\)\s*$/;

export const KNOWN_PUBLISHERS = [
  "No Starch Press",
  "Wiley",
  "Wiley-VCH",
  "Wiley-VCH Verlag GmbH & Co. KGaA",
  "Wiley-VCH GmbH",
  "John Wiley & Sons",
  "Packt Publishing",
  "Packt Publishing Pvt. Ltd.",
  "Packt Publishing Pvt Ltd",
  "Apress",
  "O'Reilly Media",
  "O'Reilly Media, Inc.",
  "O'Reilly",
  "CRC Press",
  "CRC Press_Auerbach",
  "Auerbach Publications",
  "Auerbach Publications_CRC Press",
  "Auerbach Publishers, Incorporated",
  "Manning Publications",
  "Manning Publications Co.",
  "Manning",
  "Addison-Wesley Professional",
  "Pearson",
  "Pearson Education",
  "Pearson Higher Ed",
  "Pearson Education (US)",
  "HarperCollins",
  "HarperCollinsPublishers",
  "Penguin Publishing Group",
  "Penguin Random House LLC",
  "Penguin Random House UK",
  "Penguin Random House Verlagsgruppe GmbH",
  "Penguin Verlag",
  "Albrecht Knaus Verlag",
  "Goldmann Verlag",
  "Random House Business",
  "Random House DE",
  "Crown Publishing Group",
  "Springer Vieweg",
  "Springer Gabler",
  "Springer Fachmedien Wiesbaden",
  "Springer Berlin Heidelberg",
  "Springer Fachmedien Wiesbaden_Springer Gabler",
  "Gabler Verlag",
  "Duncker & Humblot",
  "dpunkt",
  "FinanzBuch Verlag",
  "Gräfe und Unzer Verlag",
  "Koehler Publishers",
  "UVK Verlagsgesellschaft",
  "S. Fischer",
  "Kösel-Verlag",
  "arsEdition GmbH",
  "BC Publications",
  "MITP-Verlag",
  "BPB Publications",
  "Basic Books",
  "Belknap Press",
  "Scribner",
  "Gotham",
  "Knopf",
  "Hachette Books",
  "Hachette Children's Group",
  "Little, Brown and Company",
  "Open Road Media",
  "New World Library",
  "Victory Belt Publishing",
  "Celadon Books",
  "Chapman and Hall_CRC",
  "Bloomsbury Publishing Plc",
  "Head of Zeus",
  "Orbit",
  "Tom Doherty Associates",
  "Aethon Books",
  "Mountaindale Press",
  "Dandy House",
  "Hidden Gnome Publishing",
  "Black Pyramid Press",
  "Four Elephants Press",
  "DOUBLE HAPPINESS PUBLISHING",
  "Undergrove Press",
  "Magic Dome Books",
  "Magic Dome Books, s.r.o.",
  "Advantage Media Group",
  "Plata Publishing",
  "Que Publishing",
  "Peachpit Press",
  "For Dummies",
  "Daily Books",
  "Asgard",
  "Mit Press",
  "Free Press",
  "Independently published",
  "Independently Published",
] as const;

// ---------------------------------------------------------------------------
// Genre tags
// ---------------------------------------------------------------------------

export const GENRE_TAGS = [
  "A LitRPG Adventure Box Set",
  "A LitRPG Level-up Adventure",
  "A LitRPG Progression Fantasy Series",
  "A LitRPG Wuxia Series",
  "A LitRPG Wuxia",
  "A LitRPG Adventure",
  "A LitRPG Series",
  "A LitRPG",
  "A Fantasy LitRPG Adventure",
  "An Apocalypse LitRPG Series",
  "An Epic Fantasy LitRPG Adventure",
  "LitRPG Series",
  "A Portal Progression Fantasy Series",
  "A Portal Progression Fantasy",
  "A Portal Progression Adventure",
  "A Portal Progression",
  "A Daopocalypse Progression Fantasy",
  "A Progression Fantasy Series",
  "A Progression Portal Fantasy",
  "An Omnibus Collection for a Xianxia Cultivation Series",
  "A Xianxia Cultivation Novel",
  "A Xianxia Cultivation Series",
  "A Xanxia Cultivation Series",
  "A Portal Cultivation Fantasy Saga",
  "A Cultivation Novel",
  "A Wuxia Story",
  "A Divine Dungeon Series",
  "An Epic Space Fantasy Adventure",
  "A SciFi 4X LitRPG Series",
  "A Pythonic Adventure for the Intrepid Beginner",
] as const;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const genreAlternation = GENRE_TAGS
  .slice()
  .sort((a, b) => b.length - a.length)
  .map(escapeRegex)
  .join("|");

export const GENRE_TAG_REGEX = new RegExp(
  `(?:[_:\\s-]\\s*)?(?:${genreAlternation})\\s*$`,
  "i",
);

// ---------------------------------------------------------------------------
// Structural patterns — ordered specific → generic
// ---------------------------------------------------------------------------

export interface StructuralPattern {
  id: string;
  regex: RegExp;
  action: string;
}

export const STRUCTURAL_PATTERNS: StructuralPattern[] = [
  {
    id: "already_clean",
    regex: /^[A-ZÄÖÜ][a-zäöüß]+,\s+\S.+\s+-\s+.+/,
    action: "accept_as_is",
  },
  {
    id: "annas_archive_restructured",
    regex: /^(.+?)\s*--\s*(.+?)$/,
    action: "swap_and_reformat",
  },
  {
    id: "square_bracket_series_prefix",
    regex: /^\[([^\]]+?)\s+(\d+[\d.-]*)\]\s*[•·]?\s*(.+?)(?:\s+-\s+(.+))?$/,
    action: "extract_series_volume_author_title",
  },
  {
    id: "round_bracket_series_prefix",
    regex: /^\(([^)]+?)\s+(\d+[\d.-]*)\)\s*(.+?)(?:\s+-\s+(.+))?$/,
    action: "extract_series_volume_author_title",
  },
  {
    id: "terra_astra",
    regex: /^TA\s+\d+\s*-\s*(.+)$/,
    action: "reparse_remainder",
  },
  {
    id: "author_dash_title",
    regex: /^(.+?)\s+-\s+(.+)$/,
    action: "normalize_author_and_title",
  },
  {
    id: "title_only",
    regex: /^(.+)$/,
    action: "flag_for_enrichment",
  },
];

// ---------------------------------------------------------------------------
// Pen names — single-word pseudonyms that must not be flipped
// ---------------------------------------------------------------------------

export const PEN_NAMES = new Set([
  "Casualfarmer",
  "DarkTechnomancer",
  "Dosei",
  "Edontigney",
  "Exterminatus",
  "JCLouis",
  "OccupyTheWeb",
  "Ossola",
  "PSHoffman",
  "Pegaz",
  "Rhaegar",
  "RinoZ",
  "Shirtaloon",
  "Sleyca",
  "SpacePickle",
  "SquiggleStoryStudios",
  "SunriseCV",
  "TMarkos",
  "TheFirstDefier",
  "TurtleMe",
  "Zogarth",
]);

// ---------------------------------------------------------------------------
// Volume extraction patterns
// ---------------------------------------------------------------------------

export const VOLUME_PATTERNS = [
  /\bBook\s+(\d+)/i,
  /\bVol\.?\s*(\d+)/i,
  /#(\d+)/,
  /\s(\d+)$/,
];

// ---------------------------------------------------------------------------
// Confidence scoring
// ---------------------------------------------------------------------------

export const CONFIDENCE = {
  HIGH_THRESHOLD: 0.7,
  MEDIUM_THRESHOLD: 0.4,
  DEDUCTIONS: {
    AUTHOR_UNKNOWN: -0.4,
    AUTHOR_LLM_ONLY: -0.3,
    SERIES_FROM_TITLE: -0.2,
    VOLUME_AMBIGUOUS: -0.2,
    TITLE_TRUNCATED: -0.1,
  },
} as const;
