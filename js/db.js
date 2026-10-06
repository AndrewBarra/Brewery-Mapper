// Local storage for breweries, visits and photos, using IndexedDB.
// Everything stays in this browser on this device.

const DB_NAME = 'brewery-mapper';
const DB_VERSION = 1;

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('breweries', { keyPath: 'id' });
        const visits = db.createObjectStore('visits', { keyPath: 'id' });
        visits.createIndex('breweryId', 'breweryId');
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('visitId', 'visitId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Ask the browser not to clear our data when space runs low.
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch { /* not supported */ }
}

export async function getAllBreweries() {
  return done((await store('breweries')).getAll());
}

export async function getBrewery(id) {
  return done((await store('breweries')).get(id));
}

export async function saveBrewery(brewery) {
  return done((await store('breweries', 'readwrite')).put(brewery));
}

export async function getAllVisits() {
  return done((await store('visits')).getAll());
}

export async function getVisitsForBrewery(breweryId) {
  const visits = await done((await store('visits')).index('breweryId').getAll(breweryId));
  return visits.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export async function getPhoto(id) {
  return done((await store('photos')).get(id));
}

// Saves a visit plus any new photo blobs, and removes photos dropped from it.
export async function saveVisit(visit, newPhotoBlobs = [], removedPhotoIds = []) {
  const db = await open();
  const tx = db.transaction(['visits', 'photos'], 'readwrite');
  const photos = tx.objectStore('photos');
  const photoIds = (visit.photoIds || []).filter((id) => !removedPhotoIds.includes(id));
  for (const id of removedPhotoIds) photos.delete(id);
  for (const blob of newPhotoBlobs) {
    const id = newId();
    photos.put({ id, visitId: visit.id, blob });
    photoIds.push(id);
  }
  const saved = { ...visit, photoIds };
  tx.objectStore('visits').put(saved);
  await txDone(tx);
  return saved;
}

export async function deleteVisit(visit) {
  const db = await open();
  const tx = db.transaction(['visits', 'photos'], 'readwrite');
  for (const id of visit.photoIds || []) tx.objectStore('photos').delete(id);
  tx.objectStore('visits').delete(visit.id);
  await txDone(tx);
}

export async function deleteBrewery(breweryId) {
  const visits = await getVisitsForBrewery(breweryId);
  const db = await open();
  const tx = db.transaction(['breweries', 'visits', 'photos'], 'readwrite');
  for (const visit of visits) {
    for (const id of visit.photoIds || []) tx.objectStore('photos').delete(id);
    tx.objectStore('visits').delete(visit.id);
  }
  tx.objectStore('breweries').delete(breweryId);
  await txDone(tx);
}
