export const FONTS = {
  serif: "Newsreader, Georgia, serif",
  sans: "'Public Sans', system-ui, sans-serif",
  mono: "'IBM Plex Mono', monospace",
};

// OpenAlex fields grouped into seven families, each with its own colour.
export const FAMILIES = [
  { key: 'med', name: 'Medicine & health', fields: ['Medicine', 'Nursing', 'Health Professions', 'Dentistry', 'Pharmacology, Toxicology and Pharmaceutics', 'Veterinary'] },
  { key: 'life', name: 'Life sciences', fields: ['Biochemistry, Genetics and Molecular Biology', 'Immunology and Microbiology', 'Neuroscience', 'Agricultural and Biological Sciences'] },
  { key: 'eng', name: 'Engineering', fields: ['Engineering', 'Materials Science', 'Chemical Engineering', 'Energy'] },
  { key: 'comp', name: 'Computing & maths', fields: ['Computer Science', 'Mathematics', 'Decision Sciences'] },
  { key: 'phys', name: 'Physical sciences', fields: ['Physics and Astronomy', 'Chemistry'] },
  { key: 'env', name: 'Environment & earth', fields: ['Environmental Science', 'Earth and Planetary Sciences'] },
  { key: 'soc', name: 'Social sciences & humanities', fields: ['Social Sciences', 'Psychology', 'Economics, Econometrics and Finance', 'Business, Management and Accounting', 'Arts and Humanities'] },
];
const FIELD_FAM = new Map();
FAMILIES.forEach((f) => f.fields.forEach((x) => FIELD_FAM.set(x, f.key)));
export const famOf = (field) => FIELD_FAM.get(field) || 'soc';
export const FAM_NAME = Object.fromEntries(FAMILIES.map((f) => [f.key, f.name]));

const F = FONTS;
// The atlas has one map style: Midnight (dark paper, light ink).
export const SKIN = {
  key: 'b', name: 'Midnight', dark: true,
  paper: '#111923', ink: '#e5edf5', ink2: '#adbdcd', neutral: '#9aafc3', road: '#8faec4', roadA: 0.30, accent: '#ffae68',
  hue: { med: '#f18ba8', life: '#85ca96', eng: '#80b5f0', comp: '#bba0ef', phys: '#69cbd0', env: '#d7bd6b', soc: '#d5ac8c' },
  uni: (s) => `500 ${s}px ${F.serif}`,
  region: (s) => `500 ${s - 0.5}px ${F.mono}`, regionTrack: 0.12,
  person: (s) => `italic 400 ${s + 1}px ${F.serif}`,
  sub: (s) => `400 ${s - 0.5}px ${F.mono}`,
};

export const YEARS = '2017–26';
export const YEARS_LONG = '2017–2026';

