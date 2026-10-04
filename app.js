(() => {
  'use strict';

  const API_SERVERS = [
    'https://de1.api.radio-browser.info',
    'https://de2.api.radio-browser.info',
    'https://at1.api.radio-browser.info',
    'https://nl1.api.radio-browser.info'
  ];

  const GENRES = [
    'pop', 'rock', 'jazz', 'classical', 'country', 'electronic', 'dance',
    'hip hop', 'r&b', 'blues', 'reggae', 'folk', 'metal', 'alternative',
    'indie', 'ambient', 'world', 'latin', 'oldies', '80s', '90s', 'news',
    'talk', 'sports', 'christian'
  ];

  const STATION_DOT_LIMIT = 1400;
  const CITY_LOOKUP_INTERVAL_MS = 1100;
  const cityCache = new Map();
  let cityLookupChain = Promise.resolve();
  let lastCityLookupAt = 0;
  const regionNames = typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' })
    : null;

  const els = {
    globe: document.getElementById('globe'),
    latReadout: document.getElementById('latReadout'),
    lonReadout: document.getElementById('lonReadout'),
    latKnobValue: document.getElementById('latKnobValue'),
    lonKnobValue: document.getElementById('lonKnobValue'),
    latKnob: document.getElementById('latKnob'),
    lonKnob: document.getElementById('lonKnob'),
    nearestBtn: document.getElementById('nearestBtn'),
    randomBtn: document.getElementById('randomBtn'),
    genreFilter: document.getElementById('genreFilter'),
    countryFilter: document.getElementById('countryFilter'),
    languageFilter: document.getElementById('languageFilter'),
    stationName: document.getElementById('stationName'),
    stationMeta: document.getElementById('stationMeta'),
    stationTags: document.getElementById('stationTags'),
    stationArt: document.getElementById('stationArt'),
    stationFallback: document.getElementById('stationFallback'),
    onAirText: document.getElementById('onAirText'),
    onAirDot: document.getElementById('onAirDot'),
    connectionText: document.getElementById('connectionText'),
    playBtn: document.getElementById('playBtn'),
    playIcon: document.getElementById('playIcon'),
    playerStatus: document.getElementById('playerStatus'),
    playerDetail: document.getElementById('playerDetail'),
    volume: document.getElementById('volume'),
    notice: document.getElementById('notice'),
    audio: document.getElementById('audio')
  };

  const state = {
    lat: 0,
    lon: 0,
    altitude: 1.72,
    station: null,
    queue: [],
    queueIndex: 0,
    hls: null,
    apiIndex: 0,
    playing: false,
    tuningFromControl: false,
    currentSearchToken: 0,
    dotStations: [],
    dotLoadToken: 0,
    locationToken: 0
  };

  const earth = new Globe(els.globe)
    .globeImageUrl('https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg')
    .bumpImageUrl('https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png')
    .backgroundImageUrl('https://cdn.jsdelivr.net/npm/three-globe/example/img/night-sky.png')
    .showAtmosphere(true)
    .atmosphereColor('#6db8dc')
    .atmosphereAltitude(0.13)
    .showGraticules(true)
    .pointLat('lat')
    .pointLng('lng')
    .pointAltitude(point => point.selected ? 0.04 : 0.012)
    .pointRadius(point => point.selected ? 0.34 : stationDotRadius(point.station))
    .pointColor(point => point.selected ? '#ff8a24' : 'rgba(244,242,233,0.82)')
    .pointResolution(6)
    .pointLabel(stationPointLabel)
    .pointsTransitionDuration(220)
    .ringsData([])
    .ringLat('lat')
    .ringLng('lng')
    .ringColor(() => ['#ffb05f', '#ff8a24', 'rgba(255,138,36,0)'])
    .ringMaxRadius(4.8)
    .ringPropagationSpeed(2.4)
    .ringRepeatPeriod(850)
    .pointOfView({ lat: 0, lng: 0, altitude: state.altitude });

  earth.controls().enablePan = false;
  earth.controls().minDistance = 160;
  earth.controls().maxDistance = 500;
  earth.controls().rotateSpeed = 0.72;
  earth.controls().zoomSpeed = 0.75;

  const resizeGlobe = () => {
    const rect = els.globe.getBoundingClientRect();
    earth.width(rect.width).height(rect.height);
  };
  new ResizeObserver(resizeGlobe).observe(els.globe);
  resizeGlobe();

  earth.onZoom((pov) => {
    if (state.tuningFromControl) return;
    state.lat = clamp(pov.lat, -90, 90);
    state.lon = wrapLongitude(pov.lng);
    state.altitude = pov.altitude;
    updateCoordinateUI();
  });

  earth.onGlobeClick(({ lat, lng }) => {
    setTuning(lat, lng, { animate: true });
  });

  earth.onPointClick((point) => {
    if (!point?.station) return;
    state.queue = [point.station];
    state.queueIndex = 0;
    tuneStation(point.station, true);
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function wrapLongitude(value) {
    let v = value;
    while (v > 180) v -= 360;
    while (v < -180) v += 360;
    return v;
  }

  function formatLat(value) {
    return `${Math.abs(value).toFixed(2)}° ${value >= 0 ? 'N' : 'S'}`;
  }

  function formatLon(value) {
    return `${Math.abs(value).toFixed(2)}° ${value >= 0 ? 'E' : 'W'}`;
  }

  function valueToRotation(value, min, max) {
    const t = (value - min) / (max - min);
    return -135 + (t * 270);
  }

  function updateCoordinateUI() {
    els.latReadout.textContent = formatLat(state.lat);
    els.lonReadout.textContent = formatLon(state.lon);
    els.latKnobValue.textContent = `${state.lat.toFixed(1)}°`;
    els.lonKnobValue.textContent = `${state.lon.toFixed(1)}°`;
    els.latKnob.style.setProperty('--rotation', `${valueToRotation(state.lat, -90, 90)}deg`);
    els.lonKnob.style.setProperty('--rotation', `${valueToRotation(state.lon, -180, 180)}deg`);
    els.latKnob.setAttribute('aria-valuenow', state.lat.toFixed(1));
    els.lonKnob.setAttribute('aria-valuenow', state.lon.toFixed(1));
  }

  function setTuning(lat, lon, { animate = false } = {}) {
    state.lat = clamp(Number(lat), -90, 90);
    state.lon = wrapLongitude(Number(lon));
    updateCoordinateUI();
    state.tuningFromControl = true;
    earth.pointOfView({ lat: state.lat, lng: state.lon, altitude: state.altitude }, animate ? 500 : 0);
    window.setTimeout(() => { state.tuningFromControl = false; }, animate ? 540 : 20);
  }

  function bindKnob(el, axis) {
    const config = axis === 'lat'
      ? { min: -90, max: 90, step: 0.5, get: () => state.lat, set: v => setTuning(v, state.lon) }
      : { min: -180, max: 180, step: 1, get: () => state.lon, set: v => setTuning(state.lat, v) };

    let startY = 0;
    let startX = 0;
    let startValue = 0;

    el.addEventListener('pointerdown', (event) => {
      el.setPointerCapture(event.pointerId);
      startY = event.clientY;
      startX = event.clientX;
      startValue = config.get();
      event.preventDefault();
    });

    el.addEventListener('pointermove', (event) => {
      if (!el.hasPointerCapture(event.pointerId)) return;
      const delta = (startY - event.clientY) + ((event.clientX - startX) * 0.45);
      const value = clamp(startValue + delta * config.step, config.min, config.max);
      config.set(value);
    });

    el.addEventListener('keydown', (event) => {
      if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let next = config.get();
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next += config.step;
      if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next -= config.step;
      if (event.key === 'Home') next = config.min;
      if (event.key === 'End') next = config.max;
      config.set(clamp(next, config.min, config.max));
    });
  }

  bindKnob(els.latKnob, 'lat');
  bindKnob(els.lonKnob, 'lon');
  updateCoordinateUI();

  async function apiFetch(path, timeoutMs = 12000) {
    let lastError;
    for (let attempt = 0; attempt < API_SERVERS.length; attempt += 1) {
      const serverIndex = (state.apiIndex + attempt) % API_SERVERS.length;
      const server = API_SERVERS[serverIndex];
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${server}${path}`, {
          signal: controller.signal,
          headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) throw new Error(`Directory returned ${response.status}`);
        const data = await response.json();
        state.apiIndex = serverIndex;
        els.connectionText.textContent = `DIRECTORY ${server.split('//')[1].split('.')[0].toUpperCase()}`;
        return data;
      } catch (error) {
        lastError = error;
      } finally {
        window.clearTimeout(timeout);
      }
    }
    throw lastError || new Error('Radio directory unavailable');
  }

  function queryString({ limit = 30, random = false, geo = false, httpsOnly = true } = {}) {
    const params = new URLSearchParams();
    params.set('hidebroken', 'true');
    params.set('limit', String(limit));
    if (random) params.set('order', 'random');
    if (geo) params.set('has_geo_info', 'true');
    if (httpsOnly) params.set('is_https', 'true');

    const genre = els.genreFilter.value;
    const country = els.countryFilter.value;
    const language = els.languageFilter.value;
    if (genre) params.set('tag', genre);
    if (country) params.set('countrycode', country);
    if (language) params.set('language', language);
    return params;
  }

  async function populateFilters() {
    GENRES.forEach((genre) => addOption(els.genreFilter, genre, titleCase(genre)));

    try {
      const [countries, languages] = await Promise.all([
        apiFetch('/json/countrycodes?hidebroken=true&order=stationcount&reverse=true&limit=260'),
        apiFetch('/json/languages?hidebroken=true&order=stationcount&reverse=true&limit=180')
      ]);

      const countryNames = typeof Intl.DisplayNames === 'function'
        ? new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' })
        : null;
      const countryLabel = (code) => {
        try { return countryNames?.of(code) || code; }
        catch { return code; }
      };

      countries
        .filter(item => item && item.name && item.stationcount > 0)
        .sort((a, b) => countryLabel(a.name).localeCompare(countryLabel(b.name)))
        .forEach(item => addOption(els.countryFilter, item.name, countryLabel(item.name)));

      languages
        .filter(item => item && item.name && item.stationcount > 2)
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(item => addOption(els.languageFilter, item.name, titleCase(item.name)));
    } catch (error) {
      setNotice('Filters are partially loaded; station tuning still works.', 'error');
    }
  }

  function addOption(select, value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  function titleCase(text) {
    return String(text).replace(/\b\w/g, char => char.toUpperCase());
  }

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function stationDotRadius(station) {
    const clicks = Number(station?.clickcount || 0);
    return Math.max(0.055, Math.min(0.12, 0.055 + Math.log10(clicks + 1) * 0.014));
  }

  function countryDisplayName(station) {
    if (station?._countryLabel) return station._countryLabel;
    if (station?.country) return station.country;
    if (!station?.countrycode) return '';
    try { return regionNames?.of(station.countrycode) || station.countrycode; }
    catch { return station.countrycode; }
  }

  function stationLocationLabel(station) {
    const country = countryDisplayName(station);
    if (station?._cityLabel && country) return `${station._cityLabel}, ${country}`;
    return station?._cityLabel || country || '';
  }

  function stationPointLabel(point) {
    const station = point?.station;
    if (!station) return '';
    const place = stationLocationLabel(station);
    const tags = station.tags
      ? station.tags.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 3).map(titleCase).join(' · ')
      : '';
    return `
      <div style="padding:6px 8px;max-width:240px">
        <div style="font-weight:800;margin-bottom:3px">${escapeHtml(station.name || 'Unknown station')}</div>
        <div style="opacity:.82">${escapeHtml(place || 'Location available when tuned')}</div>
        ${tags ? `<div style="opacity:.65;margin-top:3px">${escapeHtml(tags)}</div>` : ''}
      </div>
    `;
  }

  function refreshStationDots() {
    const selectedUuid = state.station?.stationuuid;
    const dots = state.dotStations
      .filter(isGeoStation)
      .map(station => ({
        station,
        lat: Number(station.geo_lat),
        lng: Number(station.geo_long),
        selected: Boolean(selectedUuid && station.stationuuid === selectedUuid)
      }));

    if (state.station && isGeoStation(state.station) && !dots.some(point => point.selected)) {
      dots.push({
        station: state.station,
        lat: Number(state.station.geo_lat),
        lng: Number(state.station.geo_long),
        selected: true
      });
    }

    earth.pointsData(dots);

    if (state.station && isGeoStation(state.station)) {
      earth.ringsData([{
        lat: Number(state.station.geo_lat),
        lng: Number(state.station.geo_long)
      }]);
    } else {
      earth.ringsData([]);
    }
  }

  async function loadStationDots() {
    const token = ++state.dotLoadToken;
    try {
      const params = queryString({ limit: STATION_DOT_LIMIT, geo: true, httpsOnly: true });
      params.set('order', 'random');
      let stations = await apiFetch(`/json/stations/search?${params}`, 18000);

      if (!stations.length) {
        const fallback = queryString({ limit: STATION_DOT_LIMIT, geo: true, httpsOnly: false });
        fallback.set('order', 'random');
        stations = await apiFetch(`/json/stations/search?${fallback}`, 18000);
      }

      if (token !== state.dotLoadToken) return;
      state.dotStations = stations.filter(isGeoStation).slice(0, STATION_DOT_LIMIT);
      refreshStationDots();
    } catch (error) {
      if (token !== state.dotLoadToken) return;
      state.dotStations = [];
      refreshStationDots();
    }
  }

  function setBusy(busy, message = '') {
    els.nearestBtn.disabled = busy;
    els.randomBtn.disabled = busy;
    if (message) setNotice(message);
  }

  async function findRandom() {
    const token = ++state.currentSearchToken;
    setBusy(true, 'Scanning the airwaves for a random station…');
    try {
      let stations = await apiFetch(`/json/stations/search?${queryString({ limit: 24, random: true, httpsOnly: true })}`);
      if (!stations.length) {
        stations = await apiFetch(`/json/stations/search?${queryString({ limit: 24, random: true, httpsOnly: false })}`);
      }
      if (token !== state.currentSearchToken) return;
      if (!stations.length) throw new Error('No matching stations found.');
      state.queue = stations.filter(isStationUsable);
      state.queueIndex = 0;
      if (!state.queue.length) throw new Error('No playable matching streams were returned.');
      await tuneStation(state.queue[0], true);
    } catch (error) {
      setNotice(error.message || 'Could not find a random station.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function findNearest() {
    const token = ++state.currentSearchToken;
    setBusy(true, 'Building a map of nearby transmitters…');
    try {
      const params = queryString({ limit: 25000, geo: true, httpsOnly: true });
      params.set('order', 'clickcount');
      params.set('reverse', 'true');
      let stations = await apiFetch(`/json/stations/search?${params}`, 22000);

      if (!stations.length) {
        const fallback = queryString({ limit: 25000, geo: true, httpsOnly: false });
        fallback.set('order', 'clickcount');
        fallback.set('reverse', 'true');
        stations = await apiFetch(`/json/stations/search?${fallback}`, 22000);
      }

      if (token !== state.currentSearchToken) return;
      const ranked = stations
        .filter(isGeoStation)
        .map(station => ({ station, distance: haversineKm(state.lat, state.lon, Number(station.geo_lat), Number(station.geo_long)) }))
        .sort((a, b) => a.distance - b.distance);

      if (!ranked.length) throw new Error('No geolocated stations matched these filters.');
      state.queue = ranked.slice(0, 16).map(item => ({ ...item.station, _distanceKm: item.distance }));
      state.queueIndex = 0;
      await tuneStation(state.queue[0], true);
    } catch (error) {
      setNotice(error.message || 'Could not find the nearest station.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function isStationUsable(station) {
    return station && station.stationuuid && (station.url_resolved || station.url) && Number(station.lastcheckok) !== 0;
  }

  function isGeoStation(station) {
    return isStationUsable(station) &&
      station.geo_lat !== null && station.geo_lat !== '' &&
      station.geo_long !== null && station.geo_long !== '' &&
      Number.isFinite(Number(station.geo_lat)) && Number.isFinite(Number(station.geo_long));
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function tuneStation(station, autoplay = false) {
    state.station = station;
    const locationToken = ++state.locationToken;

    if (isGeoStation(station)) {
      setTuning(Number(station.geo_lat), Number(station.geo_long), { animate: true });
    }

    refreshStationDots();
    renderStation(station);
    resolveStationLocation(station, locationToken);
    els.playBtn.disabled = false;
    if (autoplay) await playCurrent();
  }

  function renderStation(station) {
    els.stationName.textContent = station.name || 'Unnamed station';
    updateStationLocationDisplay(station);
    const tagText = station.tags ? station.tags.split(',').slice(0, 5).map(titleCase).join(' · ') : 'Live radio';
    els.stationTags.textContent = tagText;
    els.onAirText.textContent = 'STATION LOCKED';
    els.playerStatus.textContent = station.name || 'STATION READY';

    if (station.favicon && /^https?:\/\//i.test(station.favicon)) {
      els.stationArt.src = station.favicon;
      els.stationArt.hidden = false;
      els.stationFallback.hidden = true;
    } else {
      showFallbackArt();
    }
  }

  function updateStationLocationDisplay(station) {
    if (!station || state.station?.stationuuid !== station.stationuuid) return;
    const place = stationLocationLabel(station);
    const meta = [
      place || 'Locating station…',
      station.language ? titleCase(station.language.split(',')[0]) : '',
      station.codec ? `${station.codec}${station.bitrate ? ` ${station.bitrate}k` : ''}` : ''
    ].filter(Boolean);

    els.stationMeta.textContent = meta.join(' · ') || 'Live internet radio';
    els.playerDetail.textContent = station._distanceKm != null
      ? `${place ? `${place} · ` : ''}${formatDistance(station._distanceKm)} from tuned point`
      : (place || (station.homepage ? safeHostname(station.homepage) : 'Ready to play'));
  }

  function delay(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  function reverseGeocode(lat, lon) {
    const key = `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
    if (cityCache.has(key)) return Promise.resolve(cityCache.get(key));

    const lookup = cityLookupChain.then(async () => {
      if (cityCache.has(key)) return cityCache.get(key);
      const wait = Math.max(0, CITY_LOOKUP_INTERVAL_MS - (Date.now() - lastCityLookupAt));
      if (wait) await delay(wait);
      lastCityLookupAt = Date.now();

      const params = new URLSearchParams({
        format: 'jsonv2',
        lat: String(lat),
        lon: String(lon),
        zoom: '10',
        addressdetails: '1',
        'accept-language': navigator.language || 'en'
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) throw new Error('City lookup unavailable');
      const data = await response.json();
      const address = data.address || {};
      const result = {
        city: address.city || address.town || address.village || address.municipality || address.hamlet || address.county || '',
        country: address.country || ''
      };
      cityCache.set(key, result);
      return result;
    });

    cityLookupChain = lookup.catch(() => {});
    return lookup;
  }

  async function resolveStationLocation(station, token) {
    if (!isGeoStation(station)) return;
    try {
      const place = await reverseGeocode(Number(station.geo_lat), Number(station.geo_long));
      if (token !== state.locationToken || state.station?.stationuuid !== station.stationuuid) return;
      if (place.city) station._cityLabel = place.city;
      if (place.country) station._countryLabel = place.country;
      updateStationLocationDisplay(station);
      refreshStationDots();
    } catch {
      if (token !== state.locationToken || state.station?.stationuuid !== station.stationuuid) return;
      updateStationLocationDisplay(station);
    }
  }

  function showFallbackArt() {
    els.stationArt.removeAttribute('src');
    els.stationArt.hidden = true;
    els.stationFallback.hidden = false;
  }

  els.stationArt.addEventListener('error', showFallbackArt);

  function formatDistance(km) {
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(km < 100 ? 1 : 0)} km`;
  }

  function safeHostname(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return 'Ready to play'; }
  }

  function streamUrl(station) {
    return station.url_resolved || station.url;
  }

  function destroyPlayback() {
    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }
    els.audio.pause();
    els.audio.removeAttribute('src');
    els.audio.load();
    state.playing = false;
    els.playIcon.textContent = '▶';
  }

  async function playCurrent() {
    const station = state.station;
    if (!station) return;
    destroyPlayback();

    const url = streamUrl(station);
    if (!url) {
      setNotice('This station does not publish a stream URL.', 'error');
      return;
    }

    if (location.protocol === 'https:' && url.startsWith('http:')) {
      setNotice('This station only offers an insecure HTTP stream, which browsers block on HTTPS pages. Trying the next station…', 'error');
      return tryNextStation();
    }

    els.onAirText.textContent = 'CONNECTING';
    els.playerStatus.textContent = 'CONNECTING…';
    els.playBtn.disabled = true;

    apiFetch(`/json/url/${encodeURIComponent(station.stationuuid)}`).catch(() => {});

    try {
      if (Number(station.hls) === 1 && window.Hls && Hls.isSupported()) {
        state.hls = new Hls({ enableWorker: true, lowLatencyMode: false });
        state.hls.loadSource(url);
        state.hls.attachMedia(els.audio);
        await new Promise((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error('Stream timed out')), 9000);
          state.hls.on(Hls.Events.MANIFEST_PARSED, () => { window.clearTimeout(timer); resolve(); });
          state.hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) { window.clearTimeout(timer); reject(new Error('HLS stream failed')); }
          });
        });
      } else {
        els.audio.src = url;
      }

      els.audio.volume = Number(els.volume.value);
      await Promise.race([
        els.audio.play(),
        new Promise((_, reject) => window.setTimeout(() => reject(new Error('Stream timed out')), 9000))
      ]);
      state.playing = true;
      els.playIcon.textContent = 'Ⅱ';
      els.onAirText.textContent = 'ON AIR';
      els.playerStatus.textContent = `PLAYING ${station.name || 'STATION'}`.toUpperCase();
      els.playBtn.disabled = false;
      setNotice(station._distanceKm != null ? `Tuned to the nearest available station: ${formatDistance(station._distanceKm)} away.` : 'Live signal acquired.', 'success');
    } catch (error) {
      els.playBtn.disabled = false;
      setNotice('That stream would not play in this browser. Trying the next match…', 'error');
      await tryNextStation();
    }
  }

  async function tryNextStation() {
    if (state.queueIndex + 1 >= state.queue.length) {
      els.onAirText.textContent = 'STREAM UNAVAILABLE';
      els.playerStatus.textContent = 'NO PLAYABLE STREAM FOUND';
      els.playBtn.disabled = false;
      return;
    }
    state.queueIndex += 1;
    await tuneStation(state.queue[state.queueIndex], true);
  }

  els.playBtn.addEventListener('click', async () => {
    if (!state.station) return;
    if (state.playing) {
      els.audio.pause();
      state.playing = false;
      els.playIcon.textContent = '▶';
      els.onAirText.textContent = 'PAUSED';
      els.playerStatus.textContent = 'PAUSED';
    } else {
      try {
        await els.audio.play();
        state.playing = true;
        els.playIcon.textContent = 'Ⅱ';
        els.onAirText.textContent = 'ON AIR';
        els.playerStatus.textContent = `PLAYING ${state.station.name || 'STATION'}`.toUpperCase();
      } catch {
        await playCurrent();
      }
    }
  });

  els.audio.addEventListener('playing', () => {
    state.playing = true;
    els.playIcon.textContent = 'Ⅱ';
    els.playBtn.disabled = false;
  });

  els.audio.addEventListener('pause', () => {
    if (!els.audio.ended) {
      state.playing = false;
      els.playIcon.textContent = '▶';
    }
  });

  els.audio.addEventListener('error', () => {
    if (!state.station) return;
    setNotice('The stream dropped. Trying the next match…', 'error');
    tryNextStation();
  });

  els.volume.addEventListener('input', () => {
    els.audio.volume = Number(els.volume.value);
  });

  els.nearestBtn.addEventListener('click', findNearest);
  els.randomBtn.addEventListener('click', findRandom);

  [els.genreFilter, els.countryFilter, els.languageFilter].forEach(select => {
    select.addEventListener('change', loadStationDots);
  });

  function setNotice(message, kind = '') {
    els.notice.className = `notice${kind ? ` ${kind}` : ''}`;
    els.notice.textContent = message;
  }

  populateFilters().finally(loadStationDots);
})();
