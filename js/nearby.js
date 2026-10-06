// "Nearby" map layer: every brewery OpenStreetMap knows of in the area you're looking at,
// shown as hollow pins you can tap to log. Breweries you've already logged are hidden.
import { fetchNearbyBreweries } from './api.js';

const MIN_ZOOM = 10;          // roughly a metro area; wider areas make Overpass slow
const PREF_KEY = 'pintpins.nearby';
const MAX_KEPT = 2000;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function readPref() {
  try { return localStorage.getItem(PREF_KEY) === 'on'; } catch { return false; }
}

function writePref(on) {
  try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch { /* storage blocked */ }
}

export function initNearby({ map, findLogged, onPick }) {
  const layer = L.layerGroup().addTo(map);
  const found = new Map();   // id -> brewery
  let loadedBounds = null;   // area already fetched
  let on = false;
  let abort = null;
  let timer = null;
  let statusTimer = null;

  // Toggle button, under the zoom and US buttons.
  const button = L.DomUtil.create('a', 'nearby-btn');
  button.href = '#';
  button.setAttribute('role', 'button');
  button.title = 'Show breweries near here';
  button.innerHTML = '🍺 Nearby';
  const Toggle = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const div = L.DomUtil.create('div', 'leaflet-bar us-btn nearby-control');
      div.appendChild(button);
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(button, 'click', (e) => { L.DomEvent.preventDefault(e); setOn(!on); });
      return div;
    },
  });
  map.addControl(new Toggle());

  // Status message along the bottom of the map.
  const statusEl = L.DomUtil.create('div', 'nearby-status');
  const Status = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: () => statusEl,
  });
  map.addControl(new Status());

  function status(text, { fade = false } = {}) {
    clearTimeout(statusTimer);
    statusEl.textContent = text;
    statusEl.hidden = !text;
    if (fade && text) statusTimer = setTimeout(() => { statusEl.hidden = true; }, 3500);
  }

  function popupContent(b) {
    const el = document.createElement('div');
    const address = [b.street, b.city, b.state].filter(Boolean).join(', ');
    el.innerHTML = `
      <div class="popup-name">${esc(b.name)}</div>
      <div class="popup-sub">${esc(address || 'Address not listed')}</div>
      ${b.website ? `<div><a href="${esc(b.website)}" target="_blank" rel="noopener">Website</a></div>` : ''}
      <button type="button" class="btn primary popup-btn">+ Log a visit</button>`;
    el.querySelector('button').addEventListener('click', () => onPick(b));
    return el;
  }

  function render() {
    layer.clearLayers();
    if (!on) return;
    for (const b of found.values()) {
      if (findLogged(b)) continue;
      L.circleMarker([b.lat, b.lng], {
        radius: 8,
        color: '#1f6fdc',
        weight: 3,
        fillColor: '#ffffff',
        fillOpacity: 0.95,
        className: 'nearby-pin',
      })
        .bindTooltip(b.name, { direction: 'top', offset: [0, -8] })
        .bindPopup(() => popupContent(b))
        .addTo(layer);
    }
  }

  async function load() {
    if (!on) return;
    if (map.getZoom() < MIN_ZOOM) {
      status('Zoom in closer to see breweries near here');
      return;
    }
    const view = map.getBounds();
    if (loadedBounds && loadedBounds.contains(view)) {
      status('');
      return;
    }
    const area = view.pad(0.4);
    if (abort) abort.abort();
    abort = new AbortController();
    status('Finding breweries near here…');
    try {
      const results = await fetchNearbyBreweries(
        [area.getSouth(), area.getWest(), area.getNorth(), area.getEast()],
        abort.signal,
      );
      if (found.size + results.length > MAX_KEPT) found.clear();
      for (const b of results) found.set(b.id, b);
      loadedBounds = loadedBounds && found.size > results.length ? loadedBounds.extend(area) : area;
      render();
      const fresh = results.filter((b) => !findLogged(b)).length;
      status(fresh ? `${fresh} ${fresh === 1 ? 'brewery' : 'breweries'} you haven’t logged nearby` : 'No unlogged breweries found in this area', { fade: true });
    } catch (err) {
      if (err.name === 'AbortError') return;
      status('Couldn’t load nearby breweries right now. Try again in a minute.', { fade: true });
    }
  }

  function setOn(value) {
    on = value;
    writePref(on);
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', String(on));
    if (on) {
      load();
    } else {
      if (abort) abort.abort();
      status('');
      render();
    }
  }

  map.on('moveend', () => {
    clearTimeout(timer);
    timer = setTimeout(load, 500);
  });

  status('');
  setOn(readPref());

  return { refresh: render };
}
