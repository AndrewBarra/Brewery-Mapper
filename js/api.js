// Brewery data sources. All are free and need no API key:
// - Open Brewery DB: brewery directory, searched as you type
// - Photon (komoot): OpenStreetMap places, searched as you type
// - Nominatim: OpenStreetMap address lookup and a deeper one-off place search
// - Overpass: every brewery OpenStreetMap knows of in an area

const OBDB = 'https://api.openbrewerydb.org/v1/breweries';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const PHOTON = 'https://photon.komoot.io/api/';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

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

const OSM_TYPES = { N: 'node', W: 'way', R: 'relation', node: 'node', way: 'way', relation: 'relation' };

// The same OpenStreetMap place gets the same id whichever service found it.
function osmId(type, id) {
  return `osm-${OSM_TYPES[type] || type}-${id}`;
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

// Searches OpenStreetMap places, for breweries Open Brewery DB doesn't list.
export async function searchPlaces(query, signal) {
  const url = `${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=10&countrycodes=us&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  const hits = await res.json();
  return hits
    .filter((h) => h.name)
    .map((h) => {
      const a = h.address || {};
      return {
        id: osmId(h.osm_type, h.osm_id),
        name: h.name,
        type: '',
        street: [a.house_number, a.road].filter(Boolean).join(' '),
        city: a.city || a.town || a.village || a.hamlet || a.suburb || a.county || '',
        state: normalizeState(a.state),
        postalCode: (a.postcode || '').split('-')[0],
        country: 'United States',
        lat: parseFloat(h.lat),
        lng: parseFloat(h.lon),
        website: '',
        phone: '',
        source: 'map',
      };
    });
}

// OpenStreetMap tags that mean "this place brews or pours beer". Used to rank Photon results.
const BEER_TAGS = new Set(['craft:brewery', 'industrial:brewery', 'amenity:pub', 'amenity:bar', 'amenity:biergarten', 'amenity:restaurant', 'shop:alcohol', 'shop:beverages']);
const NOT_PLACES = new Set(['place', 'highway', 'boundary', 'landuse', 'natural', 'waterway', 'railway', 'route']);

// Search-as-you-type over OpenStreetMap places, limited to the US.
export async function searchPhoton(query, signal) {
  const url = `${PHOTON}?q=${encodeURIComponent(query)}&limit=15&lang=en&bbox=-180,15,-60,72`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  const data = await res.json();
  return data.features
    .filter((f) => f.properties.countrycode === 'US' && f.properties.name && !NOT_PLACES.has(f.properties.osm_key))
    .map((f) => {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      return {
        id: osmId(p.osm_type, p.osm_id),
        name: p.name,
        type: '',
        street: [p.housenumber, p.street].filter(Boolean).join(' '),
        city: p.city || p.town || p.village || p.district || p.county || '',
        state: normalizeState(p.state),
        postalCode: (p.postcode || '').split('-')[0],
        country: 'United States',
        lat,
        lng,
        website: '',
        phone: '',
        source: 'map',
        beerish: BEER_TAGS.has(`${p.osm_key}:${p.osm_value}`) || /brew|beer|tap|ale|hops?\b|pub\b/i.test(p.name),
      };
    })
    .sort((a, b) => b.beerish - a.beerish)
    .slice(0, 8);
}

// Every brewery OpenStreetMap knows of inside a map area ([south, west, north, east]).
export async function fetchNearbyBreweries([south, west, north, east], signal) {
  const box = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:25];
(
  nwr["craft"="brewery"](${box});
  nwr["industrial"="brewery"](${box});
  nwr["microbrewery"="yes"](${box});
);
out center tags 300;`;
  const res = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }), signal });
  if (!res.ok) throw new Error(`Nearby search failed (${res.status})`);
  const data = await res.json();
  return data.elements
    .filter((e) => e.tags && e.tags.name)
    .map((e) => {
      const t = e.tags;
      const lat = e.lat ?? e.center?.lat;
      const lng = e.lon ?? e.center?.lon;
      return {
        id: osmId(e.type, e.id),
        name: t.name,
        type: t.industrial === 'brewery' ? 'production' : '',
        street: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '),
        city: t['addr:city'] || '',
        state: normalizeState(t['addr:state']),
        postalCode: (t['addr:postcode'] || '').split('-')[0],
        country: 'United States',
        lat,
        lng,
        website: t.website || t['contact:website'] || '',
        phone: t.phone || t['contact:phone'] || '',
        source: 'map',
      };
    })
    .filter((b) => b.lat != null && b.lng != null);
}

// Fills in the address for a spot on the map (used when a place has no address tags).
export async function reverseGeocode(lat, lng) {
  const res = await fetch(`${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`);
  if (!res.ok) return null;
  const { address: a } = await res.json();
  if (!a) return null;
  return {
    street: [a.house_number, a.road].filter(Boolean).join(' '),
    city: a.city || a.town || a.village || a.hamlet || a.suburb || a.county || '',
    state: normalizeState(a.state),
    postalCode: (a.postcode || '').split('-')[0],
  };
}
