// Brewery search (Open Brewery DB) and address lookup (OpenStreetMap Nominatim).
// Both are free and need no API key.

const OBDB = 'https://api.openbrewerydb.org/v1/breweries';
const NOMINATIM = 'https://nominatim.openstreetmap.org';

const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', PR: 'Puerto Rico', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// "NC", "nc" and "North Carolina" all become "North Carolina", so states count once.
export function normalizeState(value) {
  const v = (value || '').trim();
  return STATES[v.toUpperCase()] || v;
}

function nameKey(name) {
  return (name || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(the|brewing|brewery|breweries|brew|company|co|beer|works|taproom|llc|inc)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

function metersBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}

// True when two records from different sources are probably the same brewery.
export function sameBrewery(a, b) {
  if (a.id === b.id) return true;
  if (a.lat == null || b.lat == null) return false;
  const near = metersBetween(a, b);
  if (near < 40) return true;
  const ka = nameKey(a.name);
  const kb = nameKey(b.name);
  return near < 400 && ka && kb && (ka === kb || ka.includes(kb) || kb.includes(ka));
}

function toNumber(value) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(n) ? n : null;
}

// Turns an Open Brewery DB record into the shape the app stores.
function normalize(b) {
  return {
    id: b.id,
    name: b.name,
    type: b.brewery_type || '',
    street: b.address_1 || b.street || '',
    city: b.city || '',
    state: normalizeState(b.state_province || b.state),
    postalCode: (b.postal_code || '').split('-')[0],
    country: b.country || '',
    lat: toNumber(b.latitude),
    lng: toNumber(b.longitude),
    website: b.website_url || '',
    phone: b.phone || '',
  };
}

export async function searchBreweries(query, signal) {
  const url = `${OBDB}/search?query=${encodeURIComponent(query)}&per_page=25`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Brewery search failed (${res.status})`);
  const data = await res.json();
  return data
    .map(normalize)
    .filter((b) => !b.country || b.country === 'United States');
}

// Some breweries have no coordinates; look them up by address, then by name.
// Falls back to the city center, flagged as approximate.
export async function geocode(brewery) {
  const attempts = [
    [[brewery.street, brewery.city, brewery.state, brewery.postalCode], false],
    [[brewery.name, brewery.city, brewery.state], false],
    [[brewery.city, brewery.state], true],
  ];
  for (const [parts, approximate] of attempts) {
    if (!parts[0]) continue;
    const q = parts.filter(Boolean).join(', ');
    const res = await fetch(`${NOMINATIM}/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`);
    if (!res.ok) continue;
    const [hit] = await res.json();
    if (hit) return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), approximate };
  }
  return null;
}
