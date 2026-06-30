#!/usr/bin/env node
/**
 * Treespots - generate-data.js
 * Genere treespots-data.json pour les communes bruxelloises.
 * Usage: node generate-data.js
 */

const fs = require('fs');
const path = require('path');

const REGION_NAME = 'Bruxelles';
const REGION_BBOX = '50.772,4.255,50.913,4.455';
const [REGION_SOUTH, REGION_WEST, REGION_NORTH, REGION_EAST] = REGION_BBOX.split(',').map(Number);
const CACHE_DIR = path.join(__dirname, '.cache');
const COOLING_POINTS_CSV = path.join(__dirname, 'treespots_cooling_points.csv');
const MULTI_COMMUNE_WATER_OVERRIDES = {
  'etang du bois de la cambre': ['ixelles', 'uccle', 'watermael']
};

const COMMUNES = [
  { slug: 'anderlecht', label: 'Anderlecht', aliases: ['anderlecht'], lat: 50.836, lon: 4.307, radiusKm: 3.2 },
  { slug: 'auderghem', label: 'Auderghem', aliases: ['auderghem', 'oudergem'], lat: 50.815, lon: 4.434, radiusKm: 2.8 },
  { slug: 'berchem', label: 'Berchem-Sainte-Agathe', aliases: ['berchem-sainte-agathe', 'sint-agatha-berchem'], lat: 50.864, lon: 4.289, radiusKm: 2.1 },
  { slug: 'bruxelles', label: 'Bruxelles-Ville', aliases: ['bruxelles', 'brussel', 'bruxelles-ville', 'stad brussel', 'ville de bruxelles'], lat: 50.847, lon: 4.352, radiusKm: 4.6 },
  { slug: 'etterbeek', label: 'Etterbeek', aliases: ['etterbeek'], lat: 50.836, lon: 4.389, radiusKm: 2.3 },
  { slug: 'evere', label: 'Evere', aliases: ['evere'], lat: 50.874, lon: 4.400, radiusKm: 2.4 },
  { slug: 'forest', label: 'Forest', aliases: ['forest', 'vorst'], lat: 50.817, lon: 4.326, radiusKm: 2.8 },
  { slug: 'ganshoren', label: 'Ganshoren', aliases: ['ganshoren'], lat: 50.875, lon: 4.310, radiusKm: 2.0 },
  { slug: 'ixelles', label: 'Ixelles', aliases: ['ixelles', 'elsene'], lat: 50.827, lon: 4.372, radiusKm: 2.7 },
  { slug: 'jette', label: 'Jette', aliases: ['jette'], lat: 50.879, lon: 4.326, radiusKm: 2.6 },
  { slug: 'koekelberg', label: 'Koekelberg', aliases: ['koekelberg'], lat: 50.863, lon: 4.327, radiusKm: 1.7 },
  { slug: 'molenbeek', label: 'Molenbeek-Saint-Jean', aliases: ['molenbeek-saint-jean', 'sint-jans-molenbeek', 'molenbeek'], lat: 50.854, lon: 4.326, radiusKm: 2.8 },
  { slug: 'saint-gilles', label: 'Saint-Gilles', aliases: ['saint-gilles', 'sint-gillis'], lat: 50.830, lon: 4.346, radiusKm: 2.1 },
  { slug: 'saint-josse', label: 'Saint-Josse-ten-Noode', aliases: ['saint-josse-ten-noode', 'sint-joost-ten-node', 'saint-josse'], lat: 50.856, lon: 4.373, radiusKm: 1.5 },
  { slug: 'schaerbeek', label: 'Schaerbeek', aliases: ['schaerbeek', 'schaarbeek'], lat: 50.867, lon: 4.379, radiusKm: 3.0 },
  { slug: 'uccle', label: 'Uccle', aliases: ['uccle', 'ukkel'], lat: 50.802, lon: 4.340, radiusKm: 4.4 },
  { slug: 'watermael', label: 'Watermael-Boitsfort', aliases: ['watermael-boitsfort', 'watermaal-bosvoorde'], lat: 50.800, lon: 4.409, radiusKm: 3.2 },
  { slug: 'woluwe-saint-lambert', label: 'Woluwe-Saint-Lambert', aliases: ['woluwe-saint-lambert', 'sint-lambrechts-woluwe'], lat: 50.846, lon: 4.429, radiusKm: 2.8 },
  { slug: 'woluwe-saint-pierre', label: 'Woluwe-Saint-Pierre', aliases: ['woluwe-saint-pierre', 'sint-pieters-woluwe'], lat: 50.831, lon: 4.440, radiusKm: 3.2 }
];
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cachePath(name) {
  return path.join(CACHE_DIR, `${name}.json`);
}

function writeCache(name, payload) {
  ensureCacheDir();
  fs.writeFileSync(cachePath(name), JSON.stringify({
    cachedAt: new Date().toISOString(),
    payload
  }));
}

function readCache(name) {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(name), 'utf8'));
    if (!raw || typeof raw !== 'object' || !('payload' in raw)) return null;
    return raw;
  } catch (e) {
    return null;
  }
}

async function fetchOverpassWithCache(cacheKey, query, mapFn, errorLabel) {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(50000)
      });
      if (!r.ok) continue;
      const d = await r.json();
      const mapped = mapFn(d);
      writeCache(cacheKey, mapped);
      return mapped;
    } catch (e) {
      console.warn(`${errorLabel} failed:`, endpoint, e.message);
    }
  }

  const cached = readCache(cacheKey);
  if (cached) {
    console.warn(`${errorLabel} unreachable, using cache from ${cached.cachedAt}`);
    return cached.payload;
  }

  throw new Error(`${errorLabel} unreachable`);
}

function parseHeight(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return Number.isNaN(n) ? null : n;
}

function parseArea(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isFiniteCoord(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon);
}

function isInRegionBounds(lat, lon) {
  if (!isFiniteCoord(lat, lon)) return false;
  return lat >= REGION_SOUTH && lat <= REGION_NORTH && lon >= REGION_WEST && lon <= REGION_EAST;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeSpeciesName(value) {
  return normalizeText(value);
}

function distancePointToSegmentKm(point, start, end) {
  const meanLat = ((point.lat + start.lat + end.lat) / 3) * Math.PI / 180;
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.cos(meanLat);
  const px = point.lon * kmPerDegLon;
  const py = point.lat * kmPerDegLat;
  const x1 = start.lon * kmPerDegLon;
  const y1 = start.lat * kmPerDegLat;
  const x2 = end.lon * kmPerDegLon;
  const y2 = end.lat * kmPerDegLat;
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) {
    return Math.hypot(px - x1, py - y1);
  }

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function bestPointDistanceKm(a, b) {
  if (!isFiniteCoord(a.lat, a.lon) || !isFiniteCoord(b.lat, b.lon)) return Infinity;
  return haversineKm(a.lat, a.lon, b.lat, b.lon);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells.map(cell => cell.replace(/\r$/, '').trim());
}

function parseBxlTree(t) {
  let rue = t.rue_fr || t.rue || t.rue_nl || t.adresse || t.adresse_fr
         || t.nom_rue || t.street || t.localisation || '';
  if (rue) rue = rue.replace(/^\d+\s*,?\s*/, '').split(',')[0].trim();

  const species = t.espece_fr || t.nom_francais || t.espece || t.espece_flore
               || t.nom_commun_fr || t.nom_vernaculaire || t.espece_arbre || null;
  const height = parseHeight(t.hauteur || t.hauteur_m || t.height || t.taille);

  let lat = null;
  let lon = null;
  if (t.geo_point_2d) {
    lat = t.geo_point_2d.lat ?? t.geo_point_2d[0];
    lon = t.geo_point_2d.lon ?? t.geo_point_2d[1];
  } else if (t.latitude) {
    lat = parseFloat(t.latitude);
    lon = parseFloat(t.longitude);
  }

  return { rue: rue || null, species, height, lat, lon, source: 'bxl' };
}

function getCommuneMatchFromText(rawText) {
  const normalized = normalizeText(rawText);
  return COMMUNES.find(commune => commune.aliases.some(alias => normalized.includes(alias)));
}

function getClosestCommune(lat, lon) {
  if (!isFiniteCoord(lat, lon)) return null;
  let best = null;
  let minDist = Infinity;

  for (const commune of COMMUNES) {
    const dist = haversineKm(lat, lon, commune.lat, commune.lon);
    if (dist < minDist) {
      minDist = dist;
      best = commune;
    }
  }

  if (!best) return null;
  return minDist <= best.radiusKm * 1.35 ? best : null;
}

function detectCommune(tree) {
  if (isInRegionBounds(tree.lat, tree.lon)) {
    const byCoord = getClosestCommune(tree.lat, tree.lon);
    if (byCoord) return byCoord;
  }

  const textFields = [
    tree.commune,
    tree.commune_fr,
    tree.commune_nl,
    tree.nom_commune,
    tree.gemeente,
    tree.localite,
    tree.ville,
    tree.administration,
    tree.adresse,
    tree.adresse_fr,
    tree.localisation
  ];

  for (const field of textFields) {
    const match = getCommuneMatchFromText(field);
    if (match) return match;
  }

  return null;
}

function loadCoolingWaterPoints() {
  if (!fs.existsSync(COOLING_POINTS_CSV)) return [];

  const raw = fs.readFileSync(COOLING_POINTS_CSV, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
    const lat = parseFloat(row.lat);
    const lon = parseFloat(row.lon);
    const commune = (row.commune || '').trim();
    const communeMatch = commune
      ? getCommuneMatchFromText(commune)
      : getClosestCommune(lat, lon);
    const normalizedName = normalizeText(row.nom || row.adresse || 'Point d\'eau');
    const overrideSlugs = MULTI_COMMUNE_WATER_OVERRIDES[normalizedName] || null;
    const communeSlugs = overrideSlugs && overrideSlugs.length
      ? overrideSlugs
      : communeMatch?.slug ? [communeMatch.slug] : [];

    return {
      type: row.type,
      name: row.nom || row.adresse || 'Point d\'eau',
      subtype: row.sous_type || null,
      manager: row.gestionnaire || null,
      potable: normalizeText(row.potable) === 'oui',
      surfaceM2: parseArea(row.surface_m2),
      address: row.adresse || null,
      lat,
      lon,
      googleMaps: row.google_maps || null,
      communeSlug: communeMatch?.slug || null,
      communeSlugs
    };
  }).filter(point => (
    ['étang_bassin', 'fontaine_ornementale', 'fontaine_potable'].includes(point.type)
    && point.communeSlugs.length
    && isInRegionBounds(point.lat, point.lon)
  ));
}

async function fetchBxlTrees() {
  const endpoints = [
    'https://opendata.bruxelles.be/api/explore/v2.1/catalog/datasets/bruxelles_arbres_remarquables/records',
    'https://opendata.brussel.be/api/explore/v2.1/catalog/datasets/bruxelles_arbres_remarquables/records'
  ];
  const allTrees = [];

  for (const base of endpoints) {
    try {
      for (let offset = 0; offset < 400; offset += 100) {
        const url = `${base}?limit=100&offset=${offset}&timezone=Europe%2FBrussels`;
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) break;
        const d = await r.json();
        const results = d.results || d.records || [];
        const regionalTrees = results.filter(t => {
          const parsed = parseBxlTree(t);
          return Boolean(detectCommune({ ...t, ...parsed }));
        });
        allTrees.push(...regionalTrees);
        if (results.length < 100) break;
      }
      if (allTrees.length > 0) break;
    } catch (e) {
      console.warn('BXL endpoint failed:', base, e.message);
    }
  }

  return allTrees;
}

async function fetchOsmTrees() {
  const query = `[out:json][timeout:35];node["natural"="tree"](${REGION_BBOX});out body;`;
  return fetchOverpassWithCache(
    'osm-trees',
    query,
    d => (d.elements || []).filter(node => getClosestCommune(node.lat, node.lon)),
    'Overpass trees'
  );
}

async function fetchOsmRoads() {
  const query = `[out:json][timeout:40];way["highway"]["name"](${REGION_BBOX});out geom tags;`;
  return fetchOverpassWithCache(
    'osm-roads',
    query,
    d => (d.elements || []).map(w => ({
        name: w.tags.name || w.tags['name:fr'] || null,
        geometry: toArray(w.geometry).map(point => ({ lat: point.lat, lon: point.lon }))
      })).filter(w => w.name && w.geometry.length >= 2),
    'Overpass roads'
  );
}

async function fetchOsmGreenSpaces() {
  const query = `[out:json][timeout:40];
    (
      way["name"]["leisure"="park"](${REGION_BBOX});
      way["name"]["leisure"="garden"](${REGION_BBOX});
      way["name"]["garden:type"](${REGION_BBOX});
      way["name"]["landuse"="cemetery"](${REGION_BBOX});
      way["name"]["landuse"="forest"](${REGION_BBOX});
      way["name"]["natural"="wood"](${REGION_BBOX});
      way["name"]["highway"~"pedestrian|footway|path"](${REGION_BBOX});
      relation["name"]["leisure"="park"](${REGION_BBOX});
      relation["name"]["leisure"="garden"](${REGION_BBOX});
      relation["name"]["garden:type"](${REGION_BBOX});
      relation["name"]["landuse"="cemetery"](${REGION_BBOX});
      relation["name"]["landuse"="forest"](${REGION_BBOX});
      relation["name"]["natural"="wood"](${REGION_BBOX});
      relation["name"]["highway"~"pedestrian|footway|path"](${REGION_BBOX});
    );
    out center tags;`;

  return fetchOverpassWithCache(
    'osm-green-spaces',
    query,
    d => (d.elements || []).map(el => ({
        name: el.tags?.name || null,
        kind: classifyGreenSpace(el.tags || {}),
        lat: el.center?.lat,
        lon: el.center?.lon,
        communeSlug: getClosestCommune(el.center?.lat, el.center?.lon)?.slug || null
      })).filter(space => space.name && space.communeSlug && isFiniteCoord(space.lat, space.lon)),
    'Overpass green spaces'
  );
}

async function fetchOsmWaterFeatures() {
  const query = `[out:json][timeout:40];
    (
      way["natural"="water"](${REGION_BBOX});
      way["water"](${REGION_BBOX});
      way["waterway"](${REGION_BBOX});
      relation["natural"="water"](${REGION_BBOX});
      relation["water"](${REGION_BBOX});
      relation["waterway"](${REGION_BBOX});
    );
    out center tags;`;

  return fetchOverpassWithCache(
    'osm-water-features',
    query,
    d => (d.elements || []).map(el => ({
        kind: el.tags?.waterway ? 'waterway' : 'water',
        lat: el.center?.lat,
        lon: el.center?.lon
      })).filter(feature => isFiniteCoord(feature.lat, feature.lon) && getClosestCommune(feature.lat, feature.lon)),
    'Overpass water'
  );
}

function classifyGreenSpace(tags) {
  if (tags.landuse === 'cemetery') return 'cemetery';
  if (tags.leisure === 'garden' || tags['garden:type']) return 'garden';
  if (tags.highway && ['pedestrian', 'footway', 'path'].includes(tags.highway)) return 'promenade';
  if (tags.leisure === 'park') return 'park';
  return 'forest';
}

function assignToRoad(tree, roads, maxDistKm = 0.08) {
  let nearest = null;
  let minDist = Infinity;
  for (const road of roads) {
    let d = Infinity;
    for (let i = 1; i < road.geometry.length; i++) {
      const segDist = distancePointToSegmentKm(tree, road.geometry[i - 1], road.geometry[i]);
      if (segDist < d) d = segDist;
    }
    if (d < minDist && d < maxDistKm) {
      minDist = d;
      nearest = road;
    }
  }
  return nearest;
}

function dedupeStreetTrees(trees) {
  const deduped = [];
  trees.forEach(tree => {
    const duplicate = deduped.find(existing => {
      const sameSpecies = normalizeSpeciesName(existing.species) === normalizeSpeciesName(tree.species);
      const sameHeightBucket = Math.abs((existing.height ?? 0) - (tree.height ?? 0)) <= 2;
      const closeEnough = bestPointDistanceKm(existing, tree) <= 0.018;
      return closeEnough && (sameSpecies || sameHeightBucket);
    });

    if (duplicate) {
      duplicate.source = duplicate.source === tree.source ? duplicate.source : 'mixed';
      duplicate.species = duplicate.species || tree.species;
      duplicate.height = duplicate.height ?? tree.height;
      duplicate.lat = duplicate.lat ?? tree.lat;
      duplicate.lon = duplicate.lon ?? tree.lon;
      return;
    }

    deduped.push({ ...tree });
  });
  return deduped;
}

function filterRoadsForCommune(commune, roads) {
  return roads.filter(road => road.geometry.some(point => (
    haversineKm(point.lat, point.lon, commune.lat, commune.lon) <= commune.radiusKm * 1.35
  )));
}

function filterGreenSpacesForCommune(commune, greenSpaces) {
  return greenSpaces.filter(space => space.communeSlug === commune.slug);
}

function groupByStreet(bxlTrees, osmTrees, osmRoads) {
  const streets = {};
  const addToStreet = (rue, tree) => {
    if (!streets[rue]) streets[rue] = [];
    streets[rue].push(tree);
  };

  bxlTrees.forEach(rawTree => {
    const t = parseBxlTree(rawTree);
    let rue = t.rue;
    if ((!rue || rue.length < 3) && t.lat && osmRoads.length) {
      const road = assignToRoad(t, osmRoads);
      rue = road ? road.name : 'Arbres remarquables (localisation inconnue)';
    } else if (!rue || rue.length < 3) {
      rue = 'Arbres remarquables (localisation inconnue)';
    }
    addToStreet(rue, {
      species: t.species,
      height: t.height,
      lat: t.lat,
      lon: t.lon,
      source: 'bxl'
    });
  });

  osmTrees.forEach(node => {
    const tags = node.tags || {};
    const species = tags['species:fr'] || tags.species || tags['taxon:fr'] || null;
    const height = parseHeight(tags.height);
    const lat = node.lat;
    const lon = node.lon;
    let rue = tags['addr:street'] || null;

    if (!rue && osmRoads.length) {
      const road = assignToRoad({ lat, lon }, osmRoads, 0.07);
      rue = road ? road.name : null;
    }
    if (!rue) rue = 'Zones résidentielles (non renseignées)';
    addToStreet(rue, { species, height, lat, lon, source: 'osm' });
  });

  for (const rue of Object.keys(streets)) {
    streets[rue] = dedupeStreetTrees(streets[rue]);
  }
  return streets;
}

function groupByGreenSpace(osmTrees, greenSpaces) {
  const places = {};
  const addToPlace = (name, kind, tree) => {
    if (!places[name]) places[name] = { kind, trees: [] };
    places[name].trees.push(tree);
  };

  osmTrees.forEach(node => {
    if (!isFiniteCoord(node.lat, node.lon)) return;
    let nearest = null;
    let minDist = Infinity;

    for (const space of greenSpaces) {
      const dist = haversineKm(node.lat, node.lon, space.lat, space.lon);
      if (dist < minDist) {
        minDist = dist;
        nearest = space;
      }
    }

    if (!nearest) return;
    const maxDistKm = nearest.kind === 'forest' ? 0.8 : nearest.kind === 'promenade' ? 0.25 : 0.45;
    if (minDist > maxDistKm) return;

    const tags = node.tags || {};
    addToPlace(nearest.name, nearest.kind, {
      species: tags['species:fr'] || tags.species || tags['taxon:fr'] || null,
      height: parseHeight(tags.height),
      lat: node.lat,
      lon: node.lon,
      source: 'osm'
    });
  });

  for (const name of Object.keys(places)) {
    places[name].trees = dedupeStreetTrees(places[name].trees);
  }

  return places;
}

function getWaterBonus(center, waterFeatures) {
  if (!isFiniteCoord(center.lat, center.lon) || !waterFeatures.length) return 0;
  let nearest = Infinity;
  for (const feature of waterFeatures) {
    const dist = haversineKm(center.lat, center.lon, feature.lat, feature.lon);
    if (dist < nearest) nearest = dist;
  }

  if (nearest <= 0.12) return 8;
  if (nearest <= 0.25) return 5;
  if (nearest <= 0.45) return 3;
  return 0;
}

function buildWaterSpot(point, nearbyTrees) {
  const heights = nearbyTrees.map(t => t.height).filter(h => h != null);
  const avgH = heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : 0;
  const maxH = heights.length ? Math.max(...heights) : 0;
  const shadowReach = avgH > 0 ? Math.round(avgH * 0.9) : 0;
  const treeCountScore = Math.min(nearbyTrees.length / 12, 1) * 38;
  const treeHeightScore = heights.length ? Math.min(avgH / 25, 1) * 24 : 0;
  const treeBoost = nearbyTrees.length >= 20 ? 14
    : nearbyTrees.length >= 10 ? 9
    : nearbyTrees.length >= 5 ? 5
    : nearbyTrees.length >= 2 ? 2
    : 0;
  const baseBonus = point.type === 'fontaine_potable' ? 28
    : point.type === 'fontaine_ornementale' ? 24
    : 20;
  const surfaceScore = point.type === 'étang_bassin'
    ? point.surfaceM2 >= 50000 ? 36
      : point.surfaceM2 >= 10000 ? 30
      : point.surfaceM2 >= 2500 ? 24
      : point.surfaceM2 >= 600 ? 18
      : point.surfaceM2 >= 120 ? 12
      : 8
    : point.type === 'fontaine_potable' ? 12 : 10;
  const score = Math.round(Math.min(99, baseBonus + surfaceScore + treeCountScore + treeHeightScore + treeBoost));
  const speciesSet = new Set(nearbyTrees.map(t => t.species).filter(Boolean));

  return {
    rue: point.name,
    score,
    count: nearbyTrees.length,
    avgH: Math.round(avgH * 10) / 10,
    maxH,
    shadowReach,
    centLat: point.lat,
    centLon: point.lon,
    speciesList: [...speciesSet].slice(0, 5),
    hasBxl: nearbyTrees.some(t => t.source === 'bxl' || t.source === 'mixed'),
    hasOsm: true,
    placeType: 'water',
    waterKind: point.type,
    waterSubtype: point.subtype,
    waterSurfaceM2: point.surfaceM2 > 0 ? Math.round(point.surfaceM2) : null,
    waterManager: point.manager,
    waterAddress: point.address,
    potable: point.potable,
    externalMapUrl: point.googleMaps || null
  };
}

function calcScore(trees, waterBonus = 0) {
  const count = trees.length;
  const heights = trees.map(t => t.height).filter(h => h != null);
  const avgH = heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : 10;
  const maxH = heights.length ? Math.max(...heights) : 10;
  const shadowReach = Math.round(avgH * 0.9);
  const countScore = Math.min(count / 12, 1) * 60;
  const heightScore = Math.min(avgH / 25, 1) * 40;
  const score = Math.round(Math.min(99, countScore + heightScore + waterBonus));
  return { score, count, avgH: Math.round(avgH * 10) / 10, maxH, shadowReach, waterBonus };
}

function centroid(trees) {
  const valid = trees.filter(tree => isFiniteCoord(tree.lat, tree.lon));
  if (!valid.length) return { lat: null, lon: null };
  return {
    lat: valid.reduce((sum, tree) => sum + tree.lat, 0) / valid.length,
    lon: valid.reduce((sum, tree) => sum + tree.lon, 0) / valid.length
  };
}

async function fetchOptional(label, loader, fallbackValue) {
  try {
    return {
      data: await loader(),
      warning: null
    };
  } catch (err) {
    return {
      data: fallbackValue,
      warning: `${label}: ${err.message}`
    };
  }
}

function buildCommuneDataset(commune, bxlRaw, osmTrees, osmRoads, osmGreenSpaces, osmWaterFeatures, coolingWaterPoints) {
  const communeBxl = bxlRaw.filter(tree => detectCommune({ ...tree, ...parseBxlTree(tree) })?.slug === commune.slug);
  const communeOsmTrees = osmTrees.filter(node => getClosestCommune(node.lat, node.lon)?.slug === commune.slug);
  const communeRoads = filterRoadsForCommune(commune, osmRoads);
  const communeGreenSpaces = filterGreenSpacesForCommune(commune, osmGreenSpaces);
  const communeCoolingWaterPoints = coolingWaterPoints.filter(point => point.communeSlugs.includes(commune.slug));
  const communeWaterFeatures = osmWaterFeatures.filter(feature => (
    haversineKm(feature.lat, feature.lon, commune.lat, commune.lon) <= commune.radiusKm * 1.45
  ));
  const allWaterFeatures = communeWaterFeatures.concat(
    communeCoolingWaterPoints.map(point => ({ kind: 'water', lat: point.lat, lon: point.lon }))
  );
  const streets = groupByStreet(communeBxl, communeOsmTrees, communeRoads);
  const greenSpots = groupByGreenSpace(communeOsmTrees, communeGreenSpaces);
  const axes = [];
  const nearbyTreePool = [
    ...communeBxl.map(tree => parseBxlTree(tree)).filter(tree => isFiniteCoord(tree.lat, tree.lon)),
    ...communeOsmTrees.map(node => ({
      species: node.tags?.['species:fr'] || node.tags?.species || node.tags?.['taxon:fr'] || null,
      height: parseHeight(node.tags?.height),
      lat: node.lat,
      lon: node.lon,
      source: 'osm'
    }))
  ];

  for (const [rue, trees] of Object.entries(streets)) {
    if (trees.length < 2) continue;
    const center = centroid(trees);
    const waterBonus = getWaterBonus(center, allWaterFeatures);
    const { score, count, avgH, maxH, shadowReach } = calcScore(trees, waterBonus);
    const speciesSet = new Set(trees.map(t => t.species).filter(Boolean));
    const hasBxl = trees.some(t => t.source === 'bxl' || t.source === 'mixed');
    const hasOsm = trees.some(t => t.source === 'osm' || t.source === 'mixed');
    axes.push({
      rue,
      score,
      count,
      avgH,
      maxH,
      shadowReach,
      centLat: center.lat,
      centLon: center.lon,
      speciesList: [...speciesSet].slice(0, 5),
      hasBxl,
      hasOsm,
      placeType: 'street'
    });
  }

  for (const [name, entry] of Object.entries(greenSpots)) {
    const trees = entry.trees;
    if (trees.length < 3) continue;
    const center = centroid(trees);
    const waterBonus = getWaterBonus(center, allWaterFeatures);
    const { score, count, avgH, maxH, shadowReach } = calcScore(trees, waterBonus);
    const speciesSet = new Set(trees.map(t => t.species).filter(Boolean));
    axes.push({
      rue: name,
      score,
      count,
      avgH,
      maxH,
      shadowReach,
      centLat: center.lat,
      centLon: center.lon,
      speciesList: [...speciesSet].slice(0, 5),
      hasBxl: false,
      hasOsm: true,
      placeType: entry.kind
    });
  }

  communeCoolingWaterPoints.forEach(point => {
    const radiusKm = point.type === 'fontaine_potable' ? 0.12
      : point.type === 'fontaine_ornementale' ? 0.14
      : point.surfaceM2 >= 10000 ? 0.35
      : point.surfaceM2 >= 2500 ? 0.25
      : 0.18;
    const nearbyTrees = dedupeStreetTrees(nearbyTreePool.filter(tree => (
      haversineKm(tree.lat, tree.lon, point.lat, point.lon) <= radiusKm
    )));
    axes.push(buildWaterSpot(point, nearbyTrees));
  });

  axes.sort((a, b) => b.score - a.score);

  return {
    slug: commune.slug,
    label: commune.label,
    lat: commune.lat,
    lon: commune.lon,
    radiusKm: commune.radiusKm,
    totalTrees: Object.values(streets).reduce((sum, trees) => sum + trees.length, 0),
    sourceCounts: {
      bxlRemarkable: communeBxl.length,
      osmTrees: communeOsmTrees.length,
      osmRoads: communeRoads.length,
      greenSpaces: communeGreenSpaces.length,
      waterFeatures: communeWaterFeatures.length,
      coolingWaterPoints: communeCoolingWaterPoints.length
    },
    axes
  };
}

async function main() {
  console.log(`Generation de treespots-data.json pour ${REGION_NAME}...`);
  const coolingWaterPoints = loadCoolingWaterPoints();
  const [bxlResult, treesResult, roadsResult, greenSpacesResult, waterResult] = await Promise.all([
    fetchOptional('BXL remarkable trees', fetchBxlTrees, []),
    fetchOptional('OSM trees', fetchOsmTrees, []),
    fetchOptional('OSM roads', fetchOsmRoads, []),
    fetchOptional('OSM green spaces', fetchOsmGreenSpaces, []),
    fetchOptional('OSM water', fetchOsmWaterFeatures, [])
  ]);
  const bxlRaw = bxlResult.data;
  const osmTrees = treesResult.data;
  const osmRoads = roadsResult.data;
  const osmGreenSpaces = greenSpacesResult.data;
  const osmWaterFeatures = waterResult.data;
  const warnings = [
    bxlResult.warning,
    treesResult.warning,
    roadsResult.warning,
    greenSpacesResult.warning,
    waterResult.warning
  ].filter(Boolean);

  const communes = COMMUNES.map(commune => buildCommuneDataset(commune, bxlRaw, osmTrees, osmRoads, osmGreenSpaces, osmWaterFeatures, coolingWaterPoints));
  const output = {
    generated: new Date().toISOString(),
    region: REGION_NAME,
    defaultCommune: 'forest',
    warnings,
    totals: {
      bxlRemarkable: bxlRaw.length,
      osmTrees: osmTrees.length,
      osmRoads: osmRoads.length,
      greenSpaces: osmGreenSpaces.length,
      waterFeatures: osmWaterFeatures.length,
      coolingWaterPoints: coolingWaterPoints.length
    },
    communes
  };

  const outPath = path.join(__dirname, 'treespots-data.json');
  fs.writeFileSync(outPath, JSON.stringify(output));
  const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
  const totalAxes = communes.reduce((sum, commune) => sum + commune.axes.length, 0);

  console.log(`OK ${communes.length} communes retenues`);
  console.log(`OK ${totalAxes} axes retenus`);
  if (warnings.length) {
    console.log(`WARN ${warnings.length} source(s) partielles`);
    warnings.forEach(warning => console.log(`WARN ${warning}`));
  }
  console.log(`OK ${outPath} genere - ${sizeKb}kb`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
