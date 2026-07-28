// ---------------------------------------------------------------------------
// Stopp-Daten der Norwegen-Kreuzfahrt (AIDAprima, 02.–13.08.2026)
// Quelle: "Reisedokument Norwegen 2026.html"
// ---------------------------------------------------------------------------
const STOPS = [
  { id: 'hamburg-start', name: 'Hamburg', sub: 'Einschiffung', date: '2026-08-02', arrival: null, departure: '17:00', lat: 53.546, lon: 9.968 },
  { id: 'stavanger', name: 'Stavanger', sub: null, date: '2026-08-04', arrival: '07:30', departure: '17:30', lat: 58.970, lon: 5.733 },
  { id: 'flaam', name: 'Flåm', sub: null, date: '2026-08-05', arrival: '10:00', departure: '20:00', lat: 60.863, lon: 7.113 },
  { id: 'maloy', name: 'Måløy', sub: null, date: '2026-08-06', arrival: '09:00', departure: '18:30', lat: 61.938, lon: 5.115 },
  { id: 'trondheim', name: 'Trondheim', sub: null, date: '2026-08-07', arrival: '10:00', departure: '20:00', lat: 63.431, lon: 10.395 },
  { id: 'molde', name: 'Molde', sub: null, date: '2026-08-08', arrival: '08:00', departure: '18:00', lat: 62.737, lon: 7.161 },
  { id: 'geiranger', name: 'Geiranger', sub: null, date: '2026-08-09', arrival: '08:00', departure: '18:00', lat: 62.105, lon: 7.206 },
  { id: 'alesund', name: 'Ålesund', sub: null, date: '2026-08-10', arrival: '08:00', departure: '18:00', lat: 62.472, lon: 6.150 },
  { id: 'haugesund', name: 'Haugesund', sub: null, date: '2026-08-11', arrival: '10:30', departure: '19:30', lat: 59.414, lon: 5.268 },
  { id: 'hamburg-end', name: 'Hamburg', sub: 'Ausschiffung', date: '2026-08-13', arrival: '08:00', departure: null, lat: 53.546, lon: 9.968 },
];

// Fenster-Fallback für die beiden Hamburg-Tage ohne Ankunft bzw. Abfahrt
const DEFAULT_WINDOW_START = '00:00';
const DEFAULT_WINDOW_END = '23:00';

const CACHE_KEY = 'wetterapp-cache-v1';

// WMO weathercode -> Emoji (vereinfachtes Set)
function weatherIcon(code) {
  if (code === 0) return '☀️';
  if ([1, 2].includes(code)) return '🌤️';
  if (code === 3) return '☁️';
  if ([45, 48].includes(code)) return '🌫️';
  if ([51, 53, 55, 56, 57].includes(code)) return '🌦️';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '🌧️';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '🌨️';
  if ([95, 96, 99].includes(code)) return '⛈️';
  return '🌡️';
}

function hourIndex(hourlyTimeArr, dateStr, hhmm) {
  const target = `${dateStr}T${hhmm}`;
  let idx = hourlyTimeArr.indexOf(target);
  if (idx === -1) {
    // Fallback: nächstliegende Stunde am selben Tag
    idx = hourlyTimeArr.findIndex((t) => t.startsWith(dateStr));
  }
  return idx;
}

function windowBounds(stop) {
  const start = stop.arrival || DEFAULT_WINDOW_START;
  const end = stop.departure || DEFAULT_WINDOW_END;
  return { start, end };
}

function sliceForStop(loc, stop) {
  const { time, temperature_2m, precipitation, precipitation_probability, wind_speed_10m, weathercode } = loc.hourly;
  const { start, end } = windowBounds(stop);
  const startIdx = hourIndex(time, stop.date, start);
  const endIdx = hourIndex(time, stop.date, end);
  const dayStartIdx = time.indexOf(`${stop.date}T00:00`);
  const dayEndIdx = time.indexOf(`${stop.date}T23:00`);

  if (startIdx === -1 || endIdx === -1 || dayStartIdx === -1 || dayEndIdx === -1) {
    return null;
  }

  const winLo = Math.min(startIdx, endIdx);
  const winHi = Math.max(startIdx, endIdx);

  const windowTemps = temperature_2m.slice(winLo, winHi + 1);
  const windowWind = wind_speed_10m.slice(winLo, winHi + 1);
  const windowProb = precipitation_probability.slice(winLo, winHi + 1);

  const iconAt = (hhmm) => {
    let idx = time.indexOf(`${stop.date}T${hhmm}`);
    if (idx === -1) idx = winLo;
    return weatherIcon(weathercode[idx]);
  };

  return {
    tempMin: Math.min(...windowTemps),
    tempMax: Math.max(...windowTemps),
    windMax: Math.max(...windowWind),
    precipProbMax: Math.max(...windowProb),
    icons: {
      morning: iconAt('08:00'),
      midday: iconAt('13:00'),
      evening: iconAt('19:00'),
    },
    day: {
      time: time.slice(dayStartIdx, dayEndIdx + 1),
      temp: temperature_2m.slice(dayStartIdx, dayEndIdx + 1),
      precip: precipitation.slice(dayStartIdx, dayEndIdx + 1),
      prob: precipitation_probability.slice(dayStartIdx, dayEndIdx + 1),
      wind: wind_speed_10m.slice(dayStartIdx, dayEndIdx + 1),
    },
    windowRange: [winLo - dayStartIdx, winHi - dayStartIdx],
  };
}

function uniqueLocations(stops) {
  const seen = new Map();
  for (const s of stops) {
    const key = `${s.lat},${s.lon}`;
    if (!seen.has(key)) seen.set(key, { lat: s.lat, lon: s.lon });
  }
  return [...seen.values()];
}

async function fetchWeather() {
  const locs = uniqueLocations(STOPS);
  const lat = locs.map((l) => l.lat).join(',');
  const lon = locs.map((l) => l.lon).join(',');
  // forecast_days=16 = das Maximum, das Open-Meteo anbietet; die API deckt damit
  // automatisch "heute bis heute+15" ab. Stopps außerhalb dieses Fensters bleiben
  // ohne Daten und werden im UI als Platzhalter angezeigt (siehe buildStopView).
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,precipitation,precipitation_probability,wind_speed_10m,weathercode` +
    `&forecast_days=16&timezone=Europe%2FOslo`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo Fehler: ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : [data];

  const byKey = new Map();
  list.forEach((loc, i) => {
    const key = `${locs[i].lat},${locs[i].lon}`;
    byKey.set(key, loc);
  });

  const payload = { fetchedAt: Date.now(), byKey: Object.fromEntries(byKey) };
  localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  return payload;
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function fmtDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function fmtStamp(ts) {
  return new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function buildStopView(stop, data) {
  const key = `${stop.lat},${stop.lon}`;
  const loc = data && data.byKey ? data.byKey[key] : null;
  if (!loc) return { stop, unavailable: true };
  const agg = sliceForStop(loc, stop);
  if (!agg) return { stop, unavailable: true };
  return { stop, unavailable: false, agg };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const listEl = document.getElementById('stop-list');
const stampEl = document.getElementById('cache-stamp');
const refreshBtn = document.getElementById('refresh-btn');
const detailOverlay = document.getElementById('detail-overlay');
const detailBody = document.getElementById('detail-body');
const detailTitle = document.getElementById('detail-title');
const closeBtn = document.getElementById('close-detail');

let currentViews = [];

function render(data) {
  currentViews = STOPS.map((stop) => buildStopView(stop, data));
  listEl.innerHTML = currentViews.map(cardHtml).join('');
  listEl.querySelectorAll('.stop-card').forEach((card) => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
  stampEl.textContent = data ? `Stand: ${fmtStamp(data.fetchedAt)}` : 'Noch keine Daten geladen';
}

function cardHtml(view) {
  const { stop } = view;
  const windowLabel = stop.arrival && stop.departure
    ? `${stop.arrival}–${stop.departure} Uhr`
    : stop.arrival
      ? `ab ${stop.arrival} Uhr`
      : `bis ${stop.departure} Uhr`;

  if (view.unavailable) {
    return `
      <div class="stop-card" data-id="${stop.id}">
        <div class="stop-head">
          <div>
            <div class="stop-name">${stop.name}${stop.sub ? ` <span class="stop-sub">· ${stop.sub}</span>` : ''}</div>
            <div class="stop-meta">${fmtDate(stop.date)} · ${windowLabel}</div>
          </div>
        </div>
        <div class="placeholder">Vorhersage noch nicht verfügbar (erst ca. 16 Tage vorher)</div>
      </div>`;
  }

  const { agg } = view;
  return `
    <div class="stop-card" data-id="${stop.id}">
      <div class="stop-head">
        <div>
          <div class="stop-name">${stop.name}${stop.sub ? ` <span class="stop-sub">· ${stop.sub}</span>` : ''}</div>
          <div class="stop-meta">${fmtDate(stop.date)} · ${windowLabel}</div>
        </div>
        <div class="icons">
          <span title="früh">${agg.icons.morning}</span>
          <span title="mittag">${agg.icons.midday}</span>
          <span title="abend">${agg.icons.evening}</span>
        </div>
      </div>
      <div class="stop-stats">
        <div class="stat"><span class="stat-val">${Math.round(agg.tempMin)}°–${Math.round(agg.tempMax)}°</span><span class="stat-lbl">Temperatur</span></div>
        <div class="stat"><span class="stat-val">bis ${Math.round(agg.windMax)} km/h</span><span class="stat-lbl">Wind</span></div>
        <div class="stat"><span class="stat-val">bis ${Math.round(agg.precipProbMax)}%</span><span class="stat-lbl">Regen</span></div>
      </div>
    </div>`;
}

function openDetail(id) {
  const view = currentViews.find((v) => v.stop.id === id);
  if (!view || view.unavailable) return;
  const { stop, agg } = view;
  detailTitle.textContent = `${stop.name}${stop.sub ? ` · ${stop.sub}` : ''} — ${fmtDate(stop.date)}`;
  detailBody.innerHTML = [
    chartBlock('Temperatur (°C)', agg.day.time, agg.day.temp, agg.windowRange, 'line', '#d9713f'),
    chartBlock('Niederschlag (mm)', agg.day.time, agg.day.precip, agg.windowRange, 'bar', '#3f8f8a'),
    chartBlock('Regenwahrscheinlichkeit (%)', agg.day.time, agg.day.prob, agg.windowRange, 'bar', '#0c3b52'),
    chartBlock('Wind (km/h)', agg.day.time, agg.day.wind, agg.windowRange, 'line', '#6b7a80'),
  ].join('');
  detailOverlay.classList.add('open');
}

function closeDetail() {
  detailOverlay.classList.remove('open');
}

closeBtn.addEventListener('click', closeDetail);
detailOverlay.addEventListener('click', (e) => {
  if (e.target === detailOverlay) closeDetail();
});

// ---------------------------------------------------------------------------
// Mini-SVG-Diagramme (kein externes Chart-Framework)
// ---------------------------------------------------------------------------
function chartBlock(label, times, values, windowRange, kind, color) {
  const W = 320, H = 90, padL = 4, padR = 4, padT = 8, padB = 18;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = values.length;
  const maxV = Math.max(...values, kind === 'bar' && label.includes('%') ? 100 : -Infinity, 0.0001);
  const minV = kind === 'line' && label.includes('Temperatur') ? Math.min(...values) : 0;
  const range = (maxV - minV) || 1;

  const x = (i) => padL + (innerW * i) / (n - 1 || 1);
  const y = (v) => padT + innerH - ((v - minV) / range) * innerH;

  const [wLo, wHi] = windowRange;
  const wx1 = x(Math.max(0, wLo));
  const wx2 = x(Math.min(n - 1, wHi));
  const windowRect = wHi >= 0 && wLo <= n - 1
    ? `<rect x="${wx1}" y="${padT}" width="${Math.max(1, wx2 - wx1)}" height="${innerH}" fill="#0c3b52" opacity="0.08"></rect>`
    : '';

  let shape;
  if (kind === 'line') {
    const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    shape = `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>`;
  } else {
    const bw = Math.max(2, innerW / n - 2);
    shape = values.map((v, i) => {
      const bx = x(i) - bw / 2;
      const by = y(v);
      return `<rect x="${bx}" y="${by}" width="${bw}" height="${(padT + innerH) - by}" fill="${color}" rx="1"></rect>`;
    }).join('');
  }

  const labels = [0, 6, 12, 18].map((h) => {
    const idx = times.findIndex((t) => t.endsWith(`T${String(h).padStart(2, '0')}:00`));
    if (idx === -1) return '';
    return `<text x="${x(idx)}" y="${H - 4}" font-size="8" fill="#6b7a80" text-anchor="middle">${h}h</text>`;
  }).join('');

  return `
    <div class="chart">
      <div class="chart-label">${label}</div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="${H}">
        ${windowRect}
        ${shape}
        ${labels}
      </svg>
    </div>`;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  const cached = loadCache();
  if (cached) render(cached);

  try {
    const fresh = await fetchWeather();
    render(fresh);
  } catch (err) {
    console.error(err);
    if (!cached) {
      stampEl.textContent = 'Keine Verbindung – noch keine Daten verfügbar';
    } else {
      stampEl.textContent = `${stampEl.textContent} (Aktualisierung fehlgeschlagen)`;
    }
  }
}

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Lädt…';
  try {
    const fresh = await fetchWeather();
    render(fresh);
  } catch (err) {
    console.error(err);
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = '↻ Aktualisieren';
  }
});

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
