import * as db from './db.js';
import { searchBreweries, geocode } from './api.js';
import { shrinkPhoto } from './photos.js';

// ---- Map ----------------------------------------------------------------

const LOWER_48 = [[24.4, -125.0], [49.5, -66.9]];
// Wide enough to pan to Alaska and Hawaii, but not lose the US entirely.
const MAX_BOUNDS = [[10, -190], [75, -50]];
const STREET_ZOOM = 17;

const map = L.map('map', {
  minZoom: 2,
  zoomSnap: 0.5,
  maxZoom: 19,
  maxBounds: MAX_BOUNDS,
  maxBoundsViscosity: 0.8,
  worldCopyJump: false,
});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
map.fitBounds(LOWER_48);

const UsControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd() {
    const div = L.DomUtil.create('div', 'leaflet-bar us-btn');
    div.innerHTML = '<a href="#" role="button" title="Zoom out to the whole US">US</a>';
    L.DomEvent.on(div, 'click', (e) => { L.DomEvent.preventDefault(e); map.flyToBounds(LOWER_48); });
    L.DomEvent.disableClickPropagation(div);
    return div;
  },
});
map.addControl(new UsControl());

function pinIcon(active = false) {
  return L.divIcon({
    className: `pin-wrap${active ? ' active' : ''}`,
    html: '<div class="pin"><span>🍺</span></div>',
    iconSize: [28, 28],
    iconAnchor: [14, 34],
    popupAnchor: [0, -32],
  });
}

// ---- State --------------------------------------------------------------

const state = {
  breweries: new Map(),   // id -> brewery
  visits: new Map(),      // breweryId -> visits (newest first)
  markers: new Map(),     // breweryId -> Leaflet marker
};

async function loadAll() {
  const [breweries, visits] = await Promise.all([db.getAllBreweries(), db.getAllVisits()]);
  state.breweries = new Map(breweries.map((b) => [b.id, b]));
  state.visits = new Map();
  for (const v of visits) {
    if (!state.visits.has(v.breweryId)) state.visits.set(v.breweryId, []);
    state.visits.get(v.breweryId).push(v);
  }
  for (const list of state.visits.values()) list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  renderMarkers();
  renderList();
  renderStats();
}

function visitsOf(id) { return state.visits.get(id) || []; }

function avgRating(visits) {
  const rated = visits.filter((v) => v.rating);
  if (!rated.length) return null;
  return rated.reduce((sum, v) => sum + v.rating, 0) / rated.length;
}

// ---- Helpers ------------------------------------------------------------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function stars(rating) {
  if (rating == null) return '';
  const full = Math.round(rating);
  return `<span class="stars" aria-label="${rating.toFixed(1)} out of 5">${'★'.repeat(full)}<span class="off">${'★'.repeat(5 - full)}</span></span>`;
}

function cityState(b) { return [b.city, b.state].filter(Boolean).join(', '); }

function fullAddress(b) {
  return [b.street, b.city, [b.state, b.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

function formatDate(iso) {
  if (!iso) return 'No date';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function closeOnBackdrop(dialog) {
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) dialog.close(); });
}

// ---- Rendering ----------------------------------------------------------

function popupContent(b) {
  const visits = visitsOf(b.id);
  const avg = avgRating(visits);
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="popup-name">${esc(b.name)}</div>
    <div class="popup-sub">${esc(cityState(b))}</div>
    <div>${visits.length} visit${visits.length === 1 ? '' : 's'} ${stars(avg)}</div>
    <button type="button" class="btn primary popup-btn">Details</button>`;
  el.querySelector('button').addEventListener('click', () => openDetail(b.id));
  return el;
}

function renderMarkers() {
  for (const [id, marker] of state.markers) {
    if (!state.breweries.has(id)) { marker.remove(); state.markers.delete(id); }
  }
  for (const b of state.breweries.values()) {
    let marker = state.markers.get(b.id);
    if (!marker) {
      marker = L.marker([b.lat, b.lng], { icon: pinIcon(), title: b.name }).addTo(map);
      state.markers.set(b.id, marker);
    }
    marker.bindPopup(() => popupContent(b));
  }
}

function renderStats() {
  const all = [...state.visits.values()].flat();
  const states = new Set([...state.breweries.values()].map((b) => b.state).filter(Boolean));
  const avg = avgRating(all);
  const tiles = [
    [state.breweries.size, 'Breweries'],
    [states.size, 'States'],
    [all.length, 'Visits'],
    [avg == null ? '–' : avg.toFixed(1), 'Avg rating'],
  ];
  document.getElementById('stats').innerHTML = tiles
    .map(([v, l]) => `<div class="stat"><div class="stat-value">${esc(v)}</div><div class="stat-label">${l}</div></div>`)
    .join('');
}

const listEl = document.getElementById('list');
const filterEl = document.getElementById('filter');

function lastVisitDate(id) { return visitsOf(id)[0]?.date || ''; }

function renderList() {
  const q = filterEl.value.trim().toLowerCase();
  const items = [...state.breweries.values()]
    .filter((b) => !q || `${b.name} ${b.city} ${b.state}`.toLowerCase().includes(q))
    .sort((a, b) => lastVisitDate(b.id).localeCompare(lastVisitDate(a.id)) || a.name.localeCompare(b.name));

  if (!state.breweries.size) {
    listEl.innerHTML = '<li class="empty">No breweries yet. Search above to log your first one.</li>';
    return;
  }
  if (!items.length) {
    listEl.innerHTML = '<li class="empty">No matches.</li>';
    return;
  }
  listEl.innerHTML = items.map((b) => {
    const visits = visitsOf(b.id);
    return `<li><button type="button" data-id="${esc(b.id)}">
      <div class="list-meta"><span class="item-name">${esc(b.name)}</span>${stars(avgRating(visits))}</div>
      <div class="list-meta item-sub"><span>${esc(cityState(b))}</span><span>${visits.length} visit${visits.length === 1 ? '' : 's'}</span></div>
    </button></li>`;
  }).join('');
}

filterEl.addEventListener('input', renderList);
listEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-id]');
  if (!btn) return;
  const b = state.breweries.get(btn.dataset.id);
  focusBrewery(b);
});

function focusBrewery(b) {
  map.flyTo([b.lat, b.lng], STREET_ZOOM, { duration: 1.5 });
  const marker = state.markers.get(b.id);
  if (marker) map.once('moveend', () => marker.openPopup());
}

// ---- Search -------------------------------------------------------------

const searchEl = document.getElementById('search');
const resultsEl = document.getElementById('results');
const searchStatus = document.getElementById('search-status');
let searchTimer;
let searchAbort;
let lastResults = [];

searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchEl.value.trim();
  if (q.length < 2) {
    if (searchAbort) searchAbort.abort();
    resultsEl.innerHTML = '';
    searchStatus.textContent = '';
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 300);
});

async function runSearch(q) {
  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();
  searchStatus.textContent = 'Searching…';
  try {
    lastResults = await searchBreweries(q, searchAbort.signal);
  } catch (err) {
    if (err.name === 'AbortError') return;
    searchStatus.textContent = 'Search is unavailable right now. Check your connection and try again.';
    resultsEl.innerHTML = '';
    return;
  }
  searchStatus.textContent = lastResults.length ? '' : `No US breweries found for “${q}”.`;
  resultsEl.innerHTML = lastResults.map((b, i) => `
    <li><button type="button" data-index="${i}">
      <div><span class="item-name">${esc(b.name)}</span>${state.breweries.has(b.id) ? '<span class="badge">Logged</span>' : ''}</div>
      <div class="item-sub">${esc(fullAddress(b) || cityState(b))}</div>
    </button></li>`).join('');
}

resultsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-index]');
  if (!btn) return;
  const picked = lastResults[Number(btn.dataset.index)];
  searchEl.value = '';
  resultsEl.innerHTML = '';
  searchStatus.textContent = '';
  if (state.breweries.has(picked.id)) {
    focusBrewery(state.breweries.get(picked.id));
    openDetail(picked.id);
  } else {
    openVisitForm(picked, null);
  }
});

// ---- Visit form ---------------------------------------------------------

const visitDialog = document.getElementById('visit-dialog');
const visitForm = document.getElementById('visit-form');
const photoInput = document.getElementById('photo-input');
const photoPreviews = document.getElementById('photo-previews');
const visitError = document.getElementById('visit-error');
const saveBtn = document.getElementById('visit-save');
closeOnBackdrop(visitDialog);

const form = {
  brewery: null,     // brewery being logged (may not be saved yet)
  visit: null,       // existing visit being edited, or null
  keptPhotos: [],    // [{ id, url }] existing photos still attached
  removed: [],       // existing photo ids to delete on save
  added: [],         // [{ blob, url }] new photos
};

function clearFormPhotos() {
  for (const p of [...form.keptPhotos, ...form.added]) URL.revokeObjectURL(p.url);
  form.keptPhotos = [];
  form.added = [];
  form.removed = [];
}

function renderFormPhotos() {
  const kept = form.keptPhotos.map((p) => `<div class="thumb"><img src="${p.url}" alt=""><button type="button" class="remove" data-kept="${esc(p.id)}" aria-label="Remove photo">✕</button></div>`);
  const added = form.added.map((p, i) => `<div class="thumb"><img src="${p.url}" alt=""><button type="button" class="remove" data-added="${i}" aria-label="Remove photo">✕</button></div>`);
  photoPreviews.innerHTML = [...kept, ...added].join('');
}

photoPreviews.addEventListener('click', (e) => {
  const btn = e.target.closest('.remove');
  if (!btn) return;
  if (btn.dataset.kept) {
    const idx = form.keptPhotos.findIndex((p) => p.id === btn.dataset.kept);
    URL.revokeObjectURL(form.keptPhotos[idx].url);
    form.removed.push(btn.dataset.kept);
    form.keptPhotos.splice(idx, 1);
  } else {
    const [p] = form.added.splice(Number(btn.dataset.added), 1);
    URL.revokeObjectURL(p.url);
  }
  renderFormPhotos();
});

photoInput.addEventListener('change', async () => {
  const files = [...photoInput.files];
  photoInput.value = '';
  for (const file of files) {
    const blob = await shrinkPhoto(file);
    form.added.push({ blob, url: URL.createObjectURL(blob) });
  }
  renderFormPhotos();
});

document.getElementById('clear-rating').addEventListener('click', () => {
  visitForm.querySelectorAll('input[name="rating"]').forEach((r) => { r.checked = false; });
});

async function openVisitForm(brewery, visit) {
  clearFormPhotos();
  form.brewery = brewery;
  form.visit = visit;
  visitForm.reset();
  visitError.textContent = '';
  saveBtn.disabled = false;
  document.getElementById('visit-title').textContent = visit ? 'Edit visit' : `Log a visit`;
  document.getElementById('visit-subtitle').textContent = `${brewery.name} · ${cityState(brewery)}`;
  visitForm.date.value = visit?.date || today();
  visitForm.notes.value = visit?.notes || '';
  if (visit?.rating) visitForm.querySelector(`input[name="rating"][value="${visit.rating}"]`).checked = true;
  for (const id of visit?.photoIds || []) {
    const photo = await db.getPhoto(id);
    if (photo) form.keptPhotos.push({ id, url: URL.createObjectURL(photo.blob) });
  }
  renderFormPhotos();
  visitDialog.showModal();
}

visitDialog.addEventListener('close', clearFormPhotos);

visitForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  saveBtn.disabled = true;
  visitError.textContent = '';
  try {
    const brewery = form.brewery;
    const isNew = !state.breweries.has(brewery.id);
    if (isNew) {
      if (brewery.lat == null || brewery.lng == null) {
        saveBtn.textContent = 'Finding on map…';
        const spot = await geocode(brewery);
        if (!spot) throw new Error('Couldn’t find this brewery’s location on the map.');
        Object.assign(brewery, spot);
      }
      await db.saveBrewery({ ...brewery, addedAt: new Date().toISOString() });
    }
    const rating = visitForm.querySelector('input[name="rating"]:checked');
    const visit = {
      ...(form.visit || { id: db.newId(), breweryId: brewery.id, createdAt: new Date().toISOString(), photoIds: [] }),
      date: visitForm.date.value,
      rating: rating ? Number(rating.value) : null,
      notes: visitForm.notes.value.trim(),
    };
    await db.saveVisit(visit, form.added.map((p) => p.blob), form.removed);
    await db.requestPersistence();
    visitDialog.close();
    await loadAll();
    if (isNew) focusBrewery(state.breweries.get(brewery.id));
    openDetail(brewery.id);
  } catch (err) {
    visitError.textContent = err.message || 'Something went wrong saving this visit.';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save visit';
  }
});

// ---- Brewery detail -----------------------------------------------------

const detail = document.getElementById('detail');
closeOnBackdrop(detail);
let detailUrls = [];
let detailId = null;

function revokeDetailUrls() {
  detailUrls.forEach((u) => URL.revokeObjectURL(u));
  detailUrls = [];
}

detail.addEventListener('close', () => {
  revokeDetailUrls();
  const marker = state.markers.get(detailId);
  if (marker) marker.setIcon(pinIcon(false));
  detailId = null;
});

async function openDetail(id) {
  const b = state.breweries.get(id);
  if (!b) return;
  revokeDetailUrls();
  if (detailId && detailId !== id) state.markers.get(detailId)?.setIcon(pinIcon(false));
  detailId = id;
  state.markers.get(id)?.setIcon(pinIcon(true));

  const visits = visitsOf(id);
  const visitHtml = [];
  for (const v of visits) {
    const thumbs = [];
    for (const pid of v.photoIds || []) {
      const photo = await db.getPhoto(pid);
      if (!photo) continue;
      const url = URL.createObjectURL(photo.blob);
      detailUrls.push(url);
      thumbs.push(`<div class="thumb"><img src="${url}" alt="Photo from ${esc(formatDate(v.date))}" data-view></div>`);
    }
    visitHtml.push(`<li class="visit">
      <div class="visit-head">
        <div><span class="visit-date">${esc(formatDate(v.date))}</span> ${stars(v.rating)}</div>
        <div class="visit-tools">
          <button type="button" class="icon-btn" data-edit="${esc(v.id)}" aria-label="Edit visit">✎</button>
          <button type="button" class="icon-btn" data-delete="${esc(v.id)}" aria-label="Delete visit">🗑</button>
        </div>
      </div>
      ${v.notes ? `<p class="visit-notes">${esc(v.notes)}</p>` : ''}
      ${thumbs.length ? `<div class="photo-grid">${thumbs.join('')}</div>` : ''}
    </li>`);
  }

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.name}, ${fullAddress(b)}`)}`;
  detail.innerHTML = `
    <header class="sheet-header">
      <div>
        <h2>${esc(b.name)}</h2>
        <p class="muted">${esc(b.type ? `${b.type[0].toUpperCase()}${b.type.slice(1)} brewery` : '')}</p>
      </div>
      <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
    </header>
    <p class="detail-address">${esc(fullAddress(b))}</p>
    <div class="detail-links">
      ${b.website ? `<a href="${esc(b.website)}" target="_blank" rel="noopener">Website</a>` : ''}
      <a href="${esc(mapsUrl)}" target="_blank" rel="noopener">Directions</a>
      <a href="#" data-zoom>Show on map</a>
    </div>
    <div class="detail-actions">
      <button type="button" class="btn primary" data-add>+ Add visit</button>
      <button type="button" class="btn danger" data-remove>Remove brewery</button>
    </div>
    <ul class="visits">${visitHtml.join('') || '<li class="empty">No visits logged.</li>'}</ul>`;
  if (!detail.open) detail.showModal();
}

detail.addEventListener('click', async (e) => {
  const b = state.breweries.get(detailId);
  if (!b) return;
  const t = e.target;
  if (t.closest('[data-add]')) {
    detail.close();
    openVisitForm(b, null);
  } else if (t.closest('[data-zoom]')) {
    e.preventDefault();
    detail.close();
    focusBrewery(b);
  } else if (t.closest('[data-edit]')) {
    const visit = visitsOf(b.id).find((v) => v.id === t.closest('[data-edit]').dataset.edit);
    detail.close();
    openVisitForm(b, visit);
  } else if (t.closest('[data-delete]')) {
    const visit = visitsOf(b.id).find((v) => v.id === t.closest('[data-delete]').dataset.delete);
    if (!confirm(`Delete your ${formatDate(visit.date)} visit?`)) return;
    await db.deleteVisit(visit);
    await loadAll();
    openDetail(b.id);
  } else if (t.closest('[data-remove]')) {
    if (!confirm(`Remove ${b.name} and all its visits and photos?`)) return;
    detail.close();
    await db.deleteBrewery(b.id);
    await loadAll();
  } else if (t.matches('img[data-view]')) {
    openPhoto(t.src);
  }
});

// ---- Photo viewer -------------------------------------------------------

const viewer = document.getElementById('photo-viewer');
closeOnBackdrop(viewer);
viewer.addEventListener('click', (e) => { if (e.target.tagName === 'IMG') viewer.close(); });

function openPhoto(src) {
  viewer.querySelector('img').src = src;
  viewer.showModal();
}
photoPreviews.addEventListener('click', (e) => { if (e.target.tagName === 'IMG') openPhoto(e.target.src); });

// ---- Start --------------------------------------------------------------

loadAll().catch((err) => {
  console.error(err);
  listEl.innerHTML = '<li class="empty">Couldn’t open saved data in this browser (private browsing can block it).</li>';
});
