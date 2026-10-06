// Brewery search (Open Brewery DB) and address lookup (OpenStreetMap Nominatim).
// Both are free and need no API key.

const OBDB = 'https://api.openbrewerydb.org/v1/breweries';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

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
    state: b.state_province || b.state || '',
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

// Some breweries in the database have no coordinates; look up their address instead.
export async function geocode(brewery) {
  const attempts = [
    [brewery.street, brewery.city, brewery.state, brewery.postalCode],
    [brewery.city, brewery.state],
  ];
  for (const parts of attempts) {
    const q = parts.filter(Boolean).join(', ');
    if (!q) continue;
    const res = await fetch(`${NOMINATIM}?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`);
    if (!res.ok) continue;
    const [hit] = await res.json();
    if (hit) return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) };
  }
  return null;
}
