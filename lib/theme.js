export const FONTS = {
  serif: "Newsreader, Georgia, serif",
  sans: "'Public Sans', system-ui, sans-serif",
  mono: "'IBM Plex Mono', monospace",
  garamond: "'EB Garamond', Georgia, serif",
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
export const SKINS = {
  a: {
    key: 'a', name: 'Atlas', paper: '#f6f8fa', ink: '#1f2a35', ink2: '#566472', neutral: '#61717f', road: '#5d6c7a', roadA: 0.22, accent: '#e0600c',
    hue: { med: '#c2506a', life: '#4b9157', eng: '#3a6fb0', comp: '#7b5cb3', phys: '#1f8990', env: '#ad8926', soc: '#93603f' },
    uni: (s) => `500 ${s}px ${F.serif}`,
    region: (s) => `600 ${s}px ${F.sans}`, regionTrack: 0.17,
    person: (s) => `400 ${s}px ${F.sans}`,
    sub: (s) => `400 ${s}px ${F.sans}`,
  },
  b: {
    key: 'b', name: 'Survey', paper: '#faf7f0', ink: '#2a251e', ink2: '#665c4e', neutral: '#7d6e5a', road: '#6c5a46', roadA: 0.28, accent: '#df5b0b',
    hue: { med: '#b5465f', life: '#3f8248', eng: '#2f63a3', comp: '#6d4fa3', phys: '#177c82', env: '#97761c', soc: '#86553a' },
    uni: (s) => `500 ${s}px ${F.serif}`,
    region: (s) => `500 ${s - 0.5}px ${F.mono}`, regionTrack: 0.12,
    person: (s) => `italic 400 ${s + 1}px ${F.serif}`,
    sub: (s) => `400 ${s - 0.5}px ${F.mono}`,
  },
  c: {
    key: 'c', name: 'Engraving', paper: '#ffffff', ink: '#1a1a18', ink2: '#504c45', neutral: '#2a2a27', road: '#2a2926', roadA: 0.36, accent: '#d9580a',
    hue: { med: '#a83a52', life: '#2e7440', eng: '#24578f', comp: '#5f4295', phys: '#136c73', env: '#8a6a14', soc: '#7a4a2e' },
    uni: (s) => `500 ${s + 1.5}px ${F.garamond}`,
    region: (s) => `500 ${s + 1}px ${F.garamond}`, regionTrack: 0.14,
    person: (s) => `400 ${s + 1.5}px ${F.garamond}`,
    sub: (s) => `italic 400 ${s + 1}px ${F.garamond}`,
  },
};

export const YEARS = '2017–26';
export const YEARS_LONG = '2017–2026';
