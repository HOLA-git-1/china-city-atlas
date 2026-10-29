(function () {
  "use strict";

  const DATA = window.APP_DATA;
  const $ = (id) => document.getElementById(id);

  if (!DATA || !window.echarts) {
    const result = $("result");
    if (result) {
      result.innerHTML = '<div class="result-empty"><h3>地图加载失败</h3><p>请确认 lib/echarts.min.js 与 data/app-data.js 均存在。</p></div>';
    }
    return;
  }

  const FONT_SANS = '"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif';
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const HISTORY_KEY = "chinaCityAtlas.recent.v1";
  const HISTORY_LIMIT = 6;
  const FAVORITES_KEY = "chinaCityAtlas.favorites.v1";
  const FAVORITE_LABELS = { wish: "想去", visited: "去过" };
  const SHARE_WIDTH = 1080;
  const SHARE_HEIGHT = 1440;

  const els = {
    app: $("app"),
    map: $("map"),
    mapStage: $("mapStage"),
    mapDrawing: $("mapDrawing"),
    mapHint: $("mapHint"),
    legend: $("legend"),
    sanshaChip: $("sanshaChip"),
    toast: $("toast"),
    crumbChina: $("crumbChina"),
    crumbCurrent: $("crumbCurrent"),
    crumbSep: $("crumbSep"),
    brandHome: $("brandHome"),
    provinceDraw: $("provinceDraw"),
    zoomIn: $("zoomIn"),
    zoomOut: $("zoomOut"),
    resetView: $("resetView"),
    result: $("result"),
    drawBtn: $("drawBtn"),
    drawLabel: $("drawLabel"),
    drawSub: $("drawSub"),
    drawCount: $("drawCount"),
    searchBox: $("searchBox"),
    searchInput: $("searchInput"),
    searchResults: $("searchResults"),
    searchCount: $("searchCount"),
    searchHint: $("searchHint"),
    clearSearch: $("clearSearch"),
    historyList: $("historyList"),
    historyEmpty: $("historyEmpty"),
    clearHistory: $("clearHistory"),
    favoriteCount: $("favoriteCount"),
    wishCount: $("wishCount"),
    visitedCount: $("visitedCount"),
    favoriteList: $("favoriteList"),
    favoriteEmpty: $("favoriteEmpty"),
    shareModal: $("shareModal"),
    shareImage: $("shareImage"),
    closeShare: $("closeShare"),
    shareNativeBtn: $("shareNativeBtn"),
    saveShareBtn: $("saveShareBtn"),
    shareHint: $("shareHint"),
    placeCount: $("placeCount"),
    aboutBtn: $("aboutBtn"),
    aboutModal: $("aboutModal"),
    closeAbout: $("closeAbout"),
  };

  const cityById = new Map(DATA.cities.map((city) => [String(city.id), city]));
  const provinceMeta = DATA.provinceMeta;
  const nationalLookup = new Map(
    DATA.provinces.features.map((feature) => [feature.properties.name, feature.properties])
  );
  const provinceLookupCache = new Map();
  const citiesByProvince = new Map();

  for (const city of DATA.cities) {
    if (!citiesByProvince.has(city.provinceCode)) {
      citiesByProvince.set(city.provinceCode, []);
    }
    citiesByProvince.get(city.provinceCode).push(city);
  }

  const state = {
    mode: "china",
    provinceCode: null,
    selected: null,
    drawing: false,
    drawToken: 0,
    recent: loadRecent(),
    favorites: loadFavorites(),
    favoriteTab: "wish",
    searchItems: [],
    searchTotal: 0,
    searchActive: -1,
  };

  let chart = null;
  let chinaMapRegistered = false;
  const registeredProvinceMaps = new Set();
  let drawTimer = null;
  let drawInterval = null;
  let toastTimer = null;

  /* ------------------------------------------------------------------ */
  /* data helpers                                                        */
  /* ------------------------------------------------------------------ */

  function lookupForProvince(code) {
    if (!provinceLookupCache.has(code)) {
      const map = new Map();
      const fc = DATA.provinceCities[code];
      if (fc) {
        for (const feature of fc.features) {
          map.set(feature.properties.name, feature.properties);
        }
      }
      provinceLookupCache.set(code, map);
    }
    return provinceLookupCache.get(code);
  }

  function currentLookup() {
    return state.mode === "china"
      ? nationalLookup
      : lookupForProvince(state.provinceCode);
  }

  function ensureChinaMap() {
    if (!chinaMapRegistered) {
      echarts.registerMap("china", DATA.provinces);
      chinaMapRegistered = true;
    }
  }

  function ensureProvinceMap(code) {
    const mapName = "province-" + code;
    if (!registeredProvinceMaps.has(code)) {
      echarts.registerMap(mapName, DATA.provinceCities[code]);
      registeredProvinceMaps.add(code);
    }
    return mapName;
  }

  function randomInt(max) {
    if (max <= 1) return 0;
    if (window.crypto && window.crypto.getRandomValues) {
      const values = new Uint32Array(1);
      window.crypto.getRandomValues(values);
      return values[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function nameSizeClass(name) {
    const length = Array.from(name).length;
    if (length <= 4) return "name-xl";
    if (length <= 6) return "name-lg";
    if (length <= 9) return "name-md";
    return "name-sm";
  }

  function formatCoords(center) {
    const lng = center[0];
    const lat = center[1];
    const ew = lng >= 0 ? "E" : "W";
    const ns = lat >= 0 ? "N" : "S";
    return Math.abs(lng).toFixed(2) + "°" + ew + " · " + Math.abs(lat).toFixed(2) + "°" + ns;
  }

  function timeAgo(timestamp) {
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 45) return "刚刚";
    if (seconds < 3600) return Math.floor(seconds / 60) + " 分钟前";
    if (seconds < 86400) return Math.floor(seconds / 3600) + " 小时前";
    if (seconds < 86400 * 7) return Math.floor(seconds / 86400) + " 天前";
    const date = new Date(timestamp);
    return date.getMonth() + 1 + "/" + date.getDate();
  }

  /* ------------------------------------------------------------------ */
  /* map rendering                                                       */
  /* ------------------------------------------------------------------ */

  function buildRegions() {
    const regions = [];

    if (state.mode === "china") {
      // These two are too small to label at national scale.
      regions.push({ name: "香港特别行政区", label: { show: false } });
      regions.push({ name: "澳门特别行政区", label: { show: false } });

      // Keep the four municipality labels from crowding the Bohai / Yangtze
      // deltas too much.
      ["北京市", "天津市", "上海市", "重庆市"].forEach((name) => {
        regions.push({ name, label: { fontSize: 8.5 } });
      });

      if (state.selected) {
        regions.push({
          name: state.selected.province,
          itemStyle: {
            areaColor: "#ead8c7",
            borderColor: "rgba(196,71,47,.5)",
            borderWidth: 1.15,
          },
          // The province is already tinted; hiding its label leaves the
          // selected-city marker as the only label in that cluster.
          label: { show: false },
        });
      }
      return regions;
    }

    const fc = DATA.provinceCities[state.provinceCode];
    if (!fc) return regions;
    let hasMuted = false;

    for (const feature of fc.features) {
      const p = feature.properties;
      if (!p.selectable) {
        hasMuted = true;
        regions.push({
          name: p.name,
          itemStyle: {
            areaColor: "#f3ede3",
            borderColor: "#ded2bf",
            borderType: "dashed",
            opacity: 0.92,
          },
          label: { show: false },
        });
      }
    }

    if (state.selected && state.selected.provinceCode === state.provinceCode) {
      regions.push({
        name: state.selected.name,
        itemStyle: {
          areaColor: "#c4472f",
          borderColor: "#8e2a17",
          borderWidth: 1.35,
          shadowBlur: 18,
          shadowColor: "rgba(196,71,47,.24)",
        },
        label: {
          show: true,
          color: "#fffaf1",
          fontSize: 12,
          fontWeight: 600,
        },
      });
    }

    // On the Taiwan map, 新竹市/嘉义市 are tiny seats adjacent to their
    // counties; shrink those labels so the western corridor stays readable.
    if (state.provinceCode === "710000") {
      ["新竹市", "嘉义市"].forEach((name) => {
        regions.push({ name, label: { show: false } });
      });
    }

    // Keep the variable for future legend refinements.
    void hasMuted;
    return regions;
  }

  function formatTooltip(params) {
    if (params.seriesType === "effectScatter" && state.selected) {
      return (
        '<div class="tip"><b>' + state.selected.name + "</b>" +
        "<span>" + state.selected.province + " · " + state.selected.type + "</span>" +
        "<em>当前目的地</em></div>"
      );
    }

    const name = params.name;
    if (!name) return "";

    if (state.mode === "china") {
      const p = nationalLookup.get(name);
      if (!p) return name;
      return (
        '<div class="tip"><b>' + p.name + "</b>" +
        "<span>" + p.cityCount + " 个城市与地区</span>" +
        "<em>点击进入</em></div>"
      );
    }

    const p = currentLookup().get(name);
    if (!p) return name;
    if (p.selectable) {
      return (
        '<div class="tip"><b>' + p.name + "</b>" +
        "<span>" + p.type + " · " + provinceMeta[state.provinceCode].name + "</span>" +
        "<em>点击选择</em></div>"
      );
    }
    return (
      '<div class="tip"><b>' + p.name + "</b>" +
      "<span>县级行政区</span>" +
      "<em>不参与随机抽取</em></div>"
    );
  }

  function buildMarkerSeries() {
    const city = state.selected;
    return {
      id: "selected-city",
      type: "effectScatter",
      coordinateSystem: "geo",
      geoIndex: 0,
      zlevel: 3,
      symbol: "circle",
      symbolSize: 8,
      rippleEffect: {
        brushType: "stroke",
        scale: 3.2,
        period: 4.2,
        number: 3,
      },
      itemStyle: {
        color: "#c4472f",
        borderColor: "#fff8ed",
        borderWidth: 1.5,
        shadowBlur: 12,
        shadowColor: "rgba(196,71,47,.45)",
      },
      label: {
        show: state.mode === "china" || city.id === "460300",
        formatter: city.shortName,
        position: "right",
        distance: 7,
        color: "#211d18",
        fontFamily: FONT_SANS,
        fontSize: 10.5,
        fontWeight: 600,
        backgroundColor: "rgba(251,248,242,.94)",
        borderColor: "rgba(196,71,47,.24)",
        borderWidth: 1,
        borderRadius: 4,
        padding: [4, 7],
        shadowBlur: 6,
        shadowColor: "rgba(68,50,30,.1)",
      },
      data: [
        {
          name: city.name,
          value: [city.center[0], city.center[1], 100],
        },
      ],
    };
  }

  // Hainan administers the South China Sea islands (三沙), whose geometry
  // reaches 4°N / 118°E. Framing all of it would shrink the main island to a
  // speck, so browse the province up close and only pull back to the sea
  // when 三沙 itself is the destination.
  function hainanBoundingCoords() {
    return state.selected && state.selected.id === "460300"
      ? [[108.35, 20.3], [113.3, 16.35]]
      : [[108.35, 20.35], [111.35, 17.85]];
  }

  function buildMapOption() {
    const provinceMode = state.mode === "province";
    const mapName = provinceMode
      ? ensureProvinceMap(state.provinceCode)
      : "china";
    const lookup = currentLookup();

    const option = {
      animation: true,
      animationDuration: REDUCED ? 0 : 480,
      animationDurationUpdate: REDUCED ? 0 : 320,
      tooltip: {
        trigger: "item",
        confine: true,
        backgroundColor: "rgba(33,29,24,.94)",
        borderWidth: 0,
        padding: [9, 11],
        textStyle: {
          color: "#faf5ea",
          fontFamily: FONT_SANS,
          fontSize: 11,
        },
        extraCssText: "border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.18);",
        formatter: formatTooltip,
      },
      geo: {
        id: "main-geo",
        map: mapName,
        roam: true,
        boundingCoords:
          provinceMode && state.provinceCode === "460000"
            ? hainanBoundingCoords()
            : undefined,
        scaleLimit: { min: 0.6, max: 12 },
        layoutCenter: ["50%", "50%"],
        layoutSize: provinceMode ? "94%" : "93%",
        selectedMode: false,
        silent: false,
        itemStyle: {
          areaColor: provinceMode ? "#eee6d7" : "#e9e1d2",
          borderColor: provinceMode ? "#d6c8b4" : "#cbbcA6",
          borderWidth: provinceMode ? 0.75 : 0.9,
          shadowColor: "rgba(84,62,38,.08)",
          shadowBlur: 14,
          shadowOffsetY: 5,
        },
        emphasis: {
          itemStyle: {
            areaColor: provinceMode ? "#e3d5c1" : "#e0d1ba",
            borderColor: "#b39b7e",
            borderWidth: 1.1,
          },
          label: {
            color: "#2a241c",
          },
        },
        label: {
          show: true,
          color: provinceMode ? "#6f6454" : "#7b6f60",
          fontFamily: FONT_SANS,
          fontSize: provinceMode ? 9.5 : 10,
          formatter: (params) => {
            const p = lookup.get(params.name);
            return p && p.shortName ? p.shortName : params.name;
          },
        },
        labelLayout: { hideOverlap: true },
        regions: buildRegions(),
      },
      series: [],
    };

    if (state.selected) {
      option.series.push(buildMarkerSeries());
    }

    return option;
  }

  function renderMap() {
    if (!chart) return;
    chart.setOption(buildMapOption(), true);
  }

  function renderAll() {
    updateChrome();
    renderMap();
    renderResult();
    renderHistory();
    renderFavorites();
  }

  /* ------------------------------------------------------------------ */
  /* result panel                                                        */
  /* ------------------------------------------------------------------ */

  function renderResult() {
    if (state.drawing) return;

    if (state.selected) {
      const city = state.selected;
      const favorite = favoriteOf(city);
      const isWish = favorite && favorite.status === "wish";
      const isVisited = favorite && favorite.status === "visited";
      els.result.setAttribute("aria-live", "polite");
      els.result.innerHTML =
        '<div class="result-selected">' +
          '<div class="result-meta">' +
            "<span>" + city.province + "</span>" +
            '<span class="meta-dot"></span>' +
            "<span>" + city.type + "</span>" +
          "</div>" +
          '<div class="result-name ' + nameSizeClass(city.name) + '">' + city.name + "</div>" +
          '<div class="result-coords">' + formatCoords(city.center) + "</div>" +
          '<div class="result-tags">' +
            '<span class="tag tag-accent">当前目的地</span>' +
            '<span class="tag">' + city.provinceShort + " · " + city.type + "</span>" +
            (favorite
              ? '<span class="tag tag-saved tag-' + favorite.status + '">' +
                FAVORITE_LABELS[favorite.status] + "</span>"
              : "") +
          "</div>" +
          '<div class="result-actions">' +
            '<button class="action-btn' + (isWish ? " is-active" : "") + '" type="button"' +
              ' data-favorite-status="wish" aria-pressed="' + Boolean(isWish) + '">' +
              '<span aria-hidden="true">☆</span> 想去' +
            "</button>" +
            '<button class="action-btn' + (isVisited ? " is-active" : "") + '" type="button"' +
              ' data-favorite-status="visited" aria-pressed="' + Boolean(isVisited) + '">' +
              '<span aria-hidden="true">✓</span> 去过' +
            "</button>" +
            '<button class="action-btn action-share" type="button" id="shareResultBtn">' +
              '<span aria-hidden="true">↗</span> 分享' +
            "</button>" +
          "</div>" +
        "</div>";
    } else if (state.mode === "province") {
      const meta = provinceMeta[state.provinceCode];
      els.result.setAttribute("aria-live", "polite");
      els.result.innerHTML =
        '<div class="result-empty">' +
          '<div class="empty-mark"><span></span></div>' +
          "<h3>在" + meta.shortName + "，选一座城</h3>" +
          "<p>点击地图上的城市直接选择，或使用地图上方的「本省随机」，让偶然替你决定。</p>" +
        "</div>";
    } else {
      els.result.setAttribute("aria-live", "polite");
      els.result.innerHTML =
        '<div class="result-empty">' +
          '<div class="empty-mark"><span></span></div>' +
          "<h3>让偶然，带你去一座城</h3>" +
          "<p>从全国 " + DATA.counts.places + " 个城市与地区中随机抽取，在地图上与它相遇。</p>" +
        "</div>";
    }

    syncDrawButton();
  }

  function renderDrawingShell() {
    els.result.setAttribute("aria-live", "off");
    els.result.innerHTML =
      '<div class="result-drawing">' +
        '<span class="rolling-label">SEARCHING THE MAP</span>' +
        '<span class="rolling-name" id="rollingName">…</span>' +
        '<span class="rolling-province" id="rollingProvince">正在穿越山河</span>' +
      "</div>";
  }

  function updateRolling(city) {
    const nameEl = $("rollingName");
    const provinceEl = $("rollingProvince");
    if (nameEl) nameEl.textContent = city.shortName;
    if (provinceEl) provinceEl.textContent = city.province + " · " + city.type;
  }

  function syncDrawButton() {
    if (!els.drawBtn) return;
    els.drawBtn.classList.toggle("is-drawing", state.drawing);
    els.drawBtn.disabled = state.drawing;
    els.provinceDraw.disabled = state.drawing;

    if (state.drawing) {
      els.drawLabel.textContent = "寻城中…";
      els.drawSub.textContent = "SEARCHING THE MAP";
    } else if (state.selected) {
      els.drawLabel.textContent = "再抽一座城";
      els.drawSub.textContent = "ONE MORE JOURNEY";
    } else {
      els.drawLabel.textContent = "抽一座城";
      els.drawSub.textContent = "FROM ALL OF CHINA";
    }
  }

  /* ------------------------------------------------------------------ */
  /* chrome                                                              */
  /* ------------------------------------------------------------------ */

  function updateChrome() {
    const isChina = state.mode === "china";
    const meta = isChina ? null : provinceMeta[state.provinceCode];

    els.crumbCurrent.textContent = isChina ? "全国" : meta.name;
    els.crumbChina.setAttribute("aria-current", isChina ? "page" : "false");
    els.mapHint.textContent = isChina
      ? "点击省份，探索城市"
      : "点击城市进行选择 · 滚轮缩放";

    els.provinceDraw.hidden = isChina || !meta || meta.cityCount <= 1;
    if (!els.provinceDraw.hidden) {
      els.provinceDraw.innerHTML = '<span aria-hidden="true">↻</span> 本省随机';
    }

    // Hainan's main-island view crops out the South China Sea islets; the
    // chip offers 三沙 (and reframes the map around it) while browsing.
    els.sanshaChip.hidden =
      isChina ||
      state.provinceCode !== "460000" ||
      Boolean(state.selected && state.selected.id === "460300");

    els.placeCount.textContent = DATA.counts.places;
    els.drawCount.textContent = DATA.counts.places;

    if (isChina) {
      els.legend.innerHTML = state.selected
        ? '<span class="legend-item"><i class="swatch swatch-province"></i><span>当前省份</span></span>' +
          '<span class="legend-item"><i class="swatch swatch-select"></i><span>当前城市</span></span>'
        : '<span class="legend-item"><i class="swatch swatch-province"></i><span>省份边界 · 点击进入</span></span>';
      els.map.setAttribute("aria-label", "中国省级行政区地图");
    } else {
      const hasMuted = DATA.provinceCities[state.provinceCode].features.some(
        (f) => !f.properties.selectable
      );
      els.legend.innerHTML =
        (state.selected
          ? '<span class="legend-item"><i class="swatch swatch-select"></i><span>当前城市</span></span>'
          : "") +
        '<span class="legend-item"><i class="swatch swatch-city"></i><span>可抽取城市</span></span>' +
        (hasMuted
          ? '<span class="legend-item"><i class="swatch swatch-muted"></i><span>县级行政区</span></span>'
          : "");
      els.map.setAttribute("aria-label", meta.name + "城市地图");
    }

    document.title = state.selected
      ? state.selected.name + " · 中国城市漫游"
      : "中国城市漫游 · 随机抽一座城";

    syncDrawButton();
  }

  function showToast(message) {
    if (!els.toast) return;
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = window.setTimeout(() => {
      els.toast.classList.remove("show");
    }, 2100);
  }

  function hideToast() {
    window.clearTimeout(toastTimer);
    if (els.toast) els.toast.classList.remove("show");
  }

  /* ------------------------------------------------------------------ */
  /* navigation & selection                                              */
  /* ------------------------------------------------------------------ */

  function enterProvince(code, options) {
    options = options || {};
    const meta = provinceMeta[code];
    if (!meta) return;

    if (state.drawing) cancelDraw();
    hideToast();

    state.mode = "province";
    state.provinceCode = code;
    let autoSelected = null;

    if (state.selected && state.selected.provinceCode !== code) {
      state.selected = null;
    }
    if (!state.selected && meta.cityCount === 1) {
      const only = citiesByProvince.get(code);
      if (only && only.length === 1) {
        state.selected = only[0];
        autoSelected = only[0];
        addHistory(only[0]);
        renderHistory();
      }
    }

    updateChrome();
    renderMap();
    renderResult();

    if (autoSelected) {
      showToast("已选择 · " + autoSelected.name);
    }
  }

  function goNational() {
    if (state.drawing) cancelDraw();
    hideToast();
    state.mode = "china";
    state.provinceCode = null;
    updateChrome();
    renderMap();
    renderResult();
  }

  function chooseCity(city, options) {
    options = options || {};
    if (!city) return;
    if (state.drawing && !options.fromDraw) cancelDraw();

    state.selected = city;
    state.mode = "province";
    state.provinceCode = city.provinceCode;
    addHistory(city);
    updateChrome();
    renderMap();
    renderResult();
    renderHistory();

    if (!options.silent) {
      showToast("已抵达 · " + city.name);
    }
  }

  function onMapClick(params) {
    if (state.drawing) return;

    if (params.seriesType === "effectScatter" && state.selected) {
      if (state.mode === "china") {
        enterProvince(state.selected.provinceCode);
      } else {
        showToast(state.selected.name + " · 当前城市");
      }
      return;
    }

    const name = params.name;
    if (!name) return;

    if (state.mode === "china") {
      const province = nationalLookup.get(name);
      if (!province) return;
      enterProvince(province.adcode);
      return;
    }

    const feature = currentLookup().get(name);
    if (!feature) return;
    if (!feature.selectable) {
      showToast("该区域为县级行政区，不参与随机抽取");
      return;
    }
    const city = cityById.get(String(feature.adcode));
    if (city) chooseCity(city);
  }

  /* ------------------------------------------------------------------ */
  /* random draw                                                         */
  /* ------------------------------------------------------------------ */

  function pickRandom(pool) {
    if (!pool.length) return null;
    let candidates = pool;
    if (pool.length > 1 && state.selected) {
      const filtered = pool.filter((city) => city.id !== state.selected.id);
      if (filtered.length) candidates = filtered;
    }
    return candidates[randomInt(candidates.length)];
  }

  function startDraw(pool) {
    if (state.drawing) return;
    if (!pool || !pool.length) {
      showToast("这里没有可抽取的城市");
      return;
    }

    const finalCity = pickRandom(pool);
    if (!finalCity) return;

    if (REDUCED) {
      chooseCity(finalCity);
      return;
    }

    cancelDraw();
    const token = ++state.drawToken;
    const previewPool = pool.length > 2 ? pool : DATA.cities;
    state.drawing = true;

    renderDrawingShell();
    updateRolling(previewPool[randomInt(previewPool.length)]);
    syncDrawButton();
    els.mapDrawing.classList.add("show");

    drawInterval = window.setInterval(() => {
      updateRolling(previewPool[randomInt(previewPool.length)]);
    }, 62);

    drawTimer = window.setTimeout(() => {
      if (token !== state.drawToken) return;
      clearDrawTimers();
      state.drawing = false;
      chooseCity(finalCity, { fromDraw: true, silent: true });
      els.mapDrawing.classList.remove("show");
      showToast("已抵达 · " + finalCity.name);
    }, 920);
  }

  function clearDrawTimers() {
    if (drawTimer) {
      window.clearTimeout(drawTimer);
      drawTimer = null;
    }
    if (drawInterval) {
      window.clearInterval(drawInterval);
      drawInterval = null;
    }
  }

  function cancelDraw() {
    state.drawToken += 1;
    clearDrawTimers();
    state.drawing = false;
    els.mapDrawing.classList.remove("show");
    syncDrawButton();
  }

  /* ------------------------------------------------------------------ */
  /* history                                                             */
  /* ------------------------------------------------------------------ */

  function loadRecent() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw
        .map((entry) => {
          const city = cityById.get(String(entry && entry.id));
          if (!city) return null;
          return { city, ts: Number(entry.ts) || Date.now() };
        })
        .filter(Boolean)
        .slice(0, HISTORY_LIMIT);
    } catch (error) {
      return [];
    }
  }

  function saveRecent() {
    try {
      window.localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify(state.recent.map((entry) => ({ id: entry.city.id, ts: entry.ts })))
      );
    } catch (error) {
      /* localStorage can be unavailable on file:// in some browsers */
    }
  }

  function addHistory(city) {
    state.recent = [
      { city, ts: Date.now() },
      ...state.recent.filter((entry) => entry.city.id !== city.id),
    ].slice(0, HISTORY_LIMIT);
    saveRecent();
  }

  function renderHistory() {
    els.historyList.innerHTML = "";
    els.historyEmpty.hidden = state.recent.length > 0;
    els.clearHistory.hidden = state.recent.length === 0;

    state.recent.forEach((entry, index) => {
      const button = document.createElement("button");
      button.className = "history-item";
      button.type = "button";
      button.setAttribute("aria-label", "前往 " + entry.city.name);

      const idx = document.createElement("span");
      idx.className = "history-index";
      idx.textContent = String(index + 1).padStart(2, "0");

      const main = document.createElement("span");
      main.className = "history-main";

      const name = document.createElement("span");
      name.className = "history-name";
      name.textContent = entry.city.name;

      const province = document.createElement("span");
      province.className = "history-province";
      province.textContent = entry.city.province + " · " + entry.city.type;

      const time = document.createElement("span");
      time.className = "history-time";
      time.textContent = timeAgo(entry.ts);

      main.appendChild(name);
      main.appendChild(province);
      button.appendChild(idx);
      button.appendChild(main);
      button.appendChild(time);

      button.addEventListener("click", () => {
        chooseCity(entry.city, { silent: true });
        showToast("已抵达 · " + entry.city.name);
      });

      els.historyList.appendChild(button);
    });
  }

  /* ------------------------------------------------------------------ */
  /* favorites                                                           */
  /* ------------------------------------------------------------------ */

  function loadFavorites() {
    const map = new Map();
    try {
      const raw = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) || "{}");
      if (!raw || typeof raw !== "object") return map;
      for (const [id, value] of Object.entries(raw)) {
        const city = cityById.get(String(id));
        if (!city) continue;
        const status =
          value === "visited" || (value && value.status === "visited") ? "visited" : "wish";
        const ts = value && typeof value === "object" ? Number(value.ts) : NaN;
        map.set(String(city.id), { city, status, ts: ts || Date.now() });
      }
    } catch (error) {
      /* corrupted or unavailable storage — start fresh */
    }
    return map;
  }

  function saveFavorites() {
    const payload = {};
    state.favorites.forEach((entry, id) => {
      payload[id] = { status: entry.status, ts: entry.ts };
    });
    try {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(payload));
    } catch (error) {
      /* localStorage can be unavailable on file:// in some browsers */
    }
  }

  function favoriteOf(city) {
    return city ? state.favorites.get(String(city.id)) || null : null;
  }

  function removeFavorite(city, options) {
    options = options || {};
    const entry = favoriteOf(city);
    if (!entry) return;
    state.favorites.delete(String(city.id));
    saveFavorites();
    renderResult();
    renderFavorites();
    if (!options.silent) {
      showToast("已从「" + FAVORITE_LABELS[entry.status] + "」移除 · " + city.name);
    }
  }

  function toggleFavorite(city, status) {
    if (!city || (status !== "wish" && status !== "visited")) return;
    const current = favoriteOf(city);
    if (current && current.status === status) {
      removeFavorite(city);
      return;
    }
    state.favorites.set(String(city.id), { city, status, ts: Date.now() });
    saveFavorites();
    renderResult();
    renderFavorites();
    showToast(
      (status === "wish" ? "已放进「想去」 · " : "已标记「去过」 · ") + city.name
    );
  }

  function renderFavorites() {
    const counts = { wish: 0, visited: 0 };
    state.favorites.forEach((entry) => {
      counts[entry.status] += 1;
    });

    els.wishCount.textContent = counts.wish;
    els.visitedCount.textContent = counts.visited;
    els.favoriteCount.textContent = counts.wish + counts.visited + " 座";

    document.querySelectorAll("[data-favorite-tab]").forEach((button) => {
      const active = button.dataset.favoriteTab === state.favoriteTab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });

    const entries = [];
    state.favorites.forEach((entry) => {
      if (entry.status === state.favoriteTab) entries.push(entry);
    });
    entries.sort((a, b) => b.ts - a.ts);

    els.favoriteList.innerHTML = "";
    els.favoriteEmpty.hidden = entries.length > 0;
    els.favoriteEmpty.textContent =
      state.favoriteTab === "wish"
        ? "在结果卡上点「想去」，把城市收进行囊"
        : "去过的地方会留在这里";

    entries.forEach((entry) => {
      const city = entry.city;

      const row = document.createElement("div");
      row.className = "fav-item";
      row.setAttribute("role", "listitem");

      const main = document.createElement("button");
      main.className = "fav-main";
      main.type = "button";
      main.setAttribute("aria-label", "前往 " + city.name);

      const mark = document.createElement("span");
      mark.className = "fav-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = entry.status === "wish" ? "想" : "过";

      const text = document.createElement("span");
      text.className = "fav-text";

      const name = document.createElement("span");
      name.className = "fav-name";
      name.textContent = city.name;

      const meta = document.createElement("span");
      meta.className = "fav-province";
      meta.textContent = city.province + " · " + city.type;

      text.appendChild(name);
      text.appendChild(meta);
      main.appendChild(mark);
      main.appendChild(text);

      const remove = document.createElement("button");
      remove.className = "fav-remove";
      remove.type = "button";
      remove.setAttribute("aria-label", "从行囊中移除 " + city.name);
      remove.textContent = "×";

      main.addEventListener("click", () => {
        chooseCity(city, { silent: true });
        showToast("已抵达 · " + city.name);
      });
      remove.addEventListener("click", () => {
        removeFavorite(city);
      });

      row.appendChild(main);
      row.appendChild(remove);
      els.favoriteList.appendChild(row);
    });
  }

  /* ------------------------------------------------------------------ */
  /* share card                                                          */
  /* ------------------------------------------------------------------ */

  function shareFileName(city) {
    return "中国城市漫游-" + city.name + ".png";
  }

  function roundedRectPath(ctx, x, y, width, height, radius) {
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
      return;
    }
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve) => {
      if (canvas.toBlob) {
        canvas.toBlob((blob) => resolve(blob), "image/png");
      } else {
        resolve(null);
      }
    });
  }

  function drawSpacedText(ctx, text, x, y, spacing) {
    if (!spacing) {
      ctx.fillText(text, x, y);
      return;
    }
    let width = 0;
    for (const char of text) width += ctx.measureText(char).width + spacing;
    width -= spacing;
    let cursor = x - width / 2;
    ctx.textAlign = "left";
    for (const char of text) {
      ctx.fillText(char, cursor, y);
      cursor += ctx.measureText(char).width + spacing;
    }
    ctx.textAlign = "center";
  }

  function collectProvincePolygons(city) {
    const fc = DATA.provinceCities[city.provinceCode];
    if (!fc) return [];

    const features = fc.features.filter((feature) => {
      // Hainan's full province spans down to ~4°N; when looking at an
      // island city, leave out 三沙's far-flung islets so the island
      // doesn't collapse into a dot.
      if (
        city.provinceCode === "460000" &&
        String(city.id) !== "460300" &&
        String(feature.properties.adcode) === "460300"
      ) {
        return false;
      }
      return true;
    });

    const polygons = [];
    for (const feature of features) {
      const geometry = feature.geometry;
      if (!geometry) continue;
      const groups =
        geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
      for (const rings of groups) {
        if (!rings || !rings.length) continue;
        polygons.push({
          rings,
          highlighted: String(feature.properties.adcode) === String(city.id),
        });
      }
    }
    return polygons;
  }

  function drawProvinceSilhouette(ctx, city, box) {
    const polygons = collectProvincePolygons(city);
    if (!polygons.length) return false;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let midLat = 0;
    let pointCount = 0;

    for (const polygon of polygons) {
      for (const ring of polygon.rings) {
        for (const point of ring) {
          midLat += point[1];
          pointCount += 1;
        }
      }
    }
    if (!pointCount) return false;
    midLat /= pointCount;

    const cosine = Math.cos((midLat * Math.PI) / 180) || 1;
    const raw = (lng, lat) => ({ x: lng * cosine, y: -lat });

    for (const polygon of polygons) {
      for (const ring of polygon.rings) {
        for (const point of ring) {
          const projected = raw(point[0], point[1]);
          if (projected.x < minX) minX = projected.x;
          if (projected.x > maxX) maxX = projected.x;
          if (projected.y < minY) minY = projected.y;
          if (projected.y > maxY) maxY = projected.y;
        }
      }
    }

    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const scale = Math.min(box.w / spanX, box.h / spanY);
    const offsetX = box.x + (box.w - spanX * scale) / 2 - minX * scale;
    const offsetY = box.y + (box.h - spanY * scale) / 2 - minY * scale;
    const project = (lng, lat) => {
      const projected = raw(lng, lat);
      return { x: projected.x * scale + offsetX, y: projected.y * scale + offsetY };
    };

    const drawGroup = (polygon) => {
      ctx.beginPath();
      for (const ring of polygon.rings) {
        ring.forEach((point, index) => {
          const p = project(point[0], point[1]);
          if (index === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
      }
      if (polygon.highlighted) {
        ctx.fillStyle = "rgba(196, 71, 47, .18)";
        ctx.fill("evenodd");
        ctx.strokeStyle = "#c4472f";
        ctx.lineWidth = 5;
        ctx.lineJoin = "round";
        ctx.stroke();
      } else {
        ctx.fillStyle = "rgba(232, 223, 208, .78)";
        ctx.fill("evenodd");
        ctx.strokeStyle = "rgba(150, 132, 108, .55)";
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    };

    polygons.filter((polygon) => !polygon.highlighted).forEach(drawGroup);
    polygons.filter((polygon) => polygon.highlighted).forEach(drawGroup);

    // Marker for the chosen city, or for municipalities whose province
    // geometry is split into districts with no matching adcode.
    const marker = project(city.center[0], city.center[1]);
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, 13, 0, Math.PI * 2);
    ctx.strokeStyle = "#c4472f";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#c4472f";
    ctx.fill();

    return true;
  }

  function buildShareCanvas(city) {
    const canvas = document.createElement("canvas");
    canvas.width = SHARE_WIDTH;
    canvas.height = SHARE_HEIGHT;
    const ctx = canvas.getContext("2d");
    const W = SHARE_WIDTH;
    const H = SHARE_HEIGHT;
    const serif = '"Songti SC","STSong","SimSun","Noto Serif SC",serif';
    const sans = '"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif';
    const mono = '"Cascadia Mono",Consolas,"SFMono-Regular",monospace';
    const accent = "#c4472f";
    const ink = "#211d18";
    const inkSoft = "#443c32";
    const muted = "#837767";
    const muted2 = "#a29685";
    const line = "rgba(200, 185, 163, .9)";

    // Paper background with a faint grid, echoing the site.
    ctx.fillStyle = "#f8f4ec";
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.2, 0, 0, W * 0.2, 0, H);
    glow.addColorStop(0, "rgba(255, 253, 247, .9)");
    glow.addColorStop(1, "rgba(238, 231, 219, .55)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(106, 88, 63, .06)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 44) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += 44) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.strokeRect(44, 44, W - 88, H - 88);
    ctx.strokeStyle = "rgba(196, 71, 47, .35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(56, 56, W - 112, H - 112);

    // Header: seal + wordmark + English line.
    ctx.fillStyle = accent;
    roundedRectPath(ctx, 92, 92, 62, 62, 12);
    ctx.fill();
    ctx.fillStyle = "#fbf6eb";
    ctx.font = "500 38px " + serif;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("城", 123, 125);

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = ink;
    ctx.font = "600 30px " + serif;
    ctx.fillText("中国城市漫游", 176, 124);
    ctx.fillStyle = muted2;
    ctx.font = "400 14px " + sans;
    drawSpacedText(ctx, "CHINA CITY ATLAS", 358, 148, 3.4);

    ctx.textAlign = "right";
    ctx.fillStyle = muted2;
    ctx.font = "400 14px " + mono;
    ctx.fillText("VOL. " + String(DATA.counts.places).padStart(3, "0"), W - 92, 120);

    // Province silhouette.
    const mapBox = { x: 104, y: 220, w: W - 208, h: 610 };
    const hasMap = drawProvinceSilhouette(ctx, city, mapBox);

    // Small caption above the name.
    ctx.textAlign = "center";
    ctx.fillStyle = muted2;
    ctx.font = "400 14px " + mono;
    drawSpacedText(ctx, hasMap ? "THE PROVINCE, AND ONE CITY" : "ONE CITY, ONE JOURNEY", W / 2, 880, 3.2);

    // City name, shrinking for long names.
    let nameSize = 112;
    ctx.font = "600 " + nameSize + "px " + serif;
    while (ctx.measureText(city.name).width > W - 240 && nameSize > 56) {
      nameSize -= 4;
      ctx.font = "600 " + nameSize + "px " + serif;
    }
    ctx.fillStyle = ink;
    ctx.fillText(city.name, W / 2, 1000);

    ctx.fillStyle = inkSoft;
    ctx.font = "400 26px " + sans;
    ctx.fillText(city.province + " · " + city.type, W / 2, 1054);

    ctx.fillStyle = muted2;
    ctx.font = "400 16px " + mono;
    ctx.fillText(
      formatCoords(city.center) + "  ·  " + formatShareDate(new Date()),
      W / 2,
      1098
    );

    ctx.strokeStyle = line;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 150, 1148);
    ctx.lineTo(W / 2 + 150, 1148);
    ctx.stroke();

    // Tagline + footer.
    ctx.fillStyle = accent;
    ctx.font = "500 17px " + sans;
    drawSpacedText(ctx, "随机抽中的下一站", W / 2, 1200, 4);

    ctx.fillStyle = muted;
    ctx.font = "400 16px " + mono;
    ctx.fillText("HOLA-git-1.github.io/china-city-atlas", W / 2, 1252);

    // Three small vermilion dots as a footer ornament.
    [-18, 0, 18].forEach((dx) => {
      ctx.beginPath();
      ctx.arc(W / 2 + dx, 1308, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(196, 71, 47, .55)";
      ctx.fill();
    });

    return canvas;
  }

  function formatShareDate(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return date.getFullYear() + "." + pad(date.getMonth() + 1) + "." + pad(date.getDate());
  }

  let shareCanvas = null;

  function openShare() {
    if (!state.selected) return;
    shareCanvas = buildShareCanvas(state.selected);
    els.shareImage.src = shareCanvas.toDataURL("image/png");
    els.shareImage.alt = state.selected.name + " 的城市分享卡片";
    els.shareModal.hidden = false;
    els.closeShare.focus();

    const native = window.NativeShare && window.NativeShare.available;
    els.saveShareBtn.hidden = Boolean(native);
    els.shareNativeBtn.textContent = native ? "分享 / 保存到相册" : "分享图片";
    els.shareHint.textContent = native
      ? "在系统分享面板里选择相册、微信或文件"
      : "在手机上也可以长按图片保存";
  }

  function closeShare() {
    els.shareModal.hidden = true;
    shareCanvas = null;
    if (els.shareImage) els.shareImage.removeAttribute("src");
  }

  function downloadShare() {
    if (!shareCanvas) return;
    const city = state.selected;
    canvasToBlob(shareCanvas).then((blob) => {
      if (!blob) {
        showToast("当前浏览器不支持保存图片");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = shareFileName(city);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast("已保存分享卡片");
    });
  }

  function shareViaNative(dataUrl, city) {
    return window.NativeShare.shareDataUrl(
      dataUrl,
      shareFileName(city),
      city.name + " · 随机抽中的下一站"
    );
  }

  function shareCard() {
    if (!shareCanvas || !state.selected) return;
    const city = state.selected;
    const fileName = shareFileName(city);
    const text = city.name + " · 随机抽中的下一站";

    if (window.NativeShare && window.NativeShare.available) {
      shareViaNative(shareCanvas.toDataURL("image/png"), city).catch((error) => {
        if (error && /cancel/i.test(String(error.message || error))) return;
        showToast("分享未完成，请重试");
      });
      return;
    }

    canvasToBlob(shareCanvas).then(async (blob) => {
      if (!blob) {
        downloadShare();
        return;
      }
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "中国城市漫游", text });
          return;
        } catch (error) {
          if (error && error.name === "AbortError") return;
        }
      }
      downloadShare();
    });
  }

  /* ------------------------------------------------------------------ */
  /* search                                                              */
  /* ------------------------------------------------------------------ */

  function matchScore(city, query) {
    const q = query.toLowerCase();
    const name = city.name.toLowerCase();
    const short = city.shortName.toLowerCase();
    const province = city.province.toLowerCase();
    const provinceShort = city.provinceShort.toLowerCase();

    if (name === q || short === q) return 100;
    if (name.startsWith(q) || short.startsWith(q)) return 80;
    if (province === q || provinceShort === q) return 60;
    if (name.includes(q) || short.includes(q)) return 40;
    if (province.includes(q) || provinceShort.includes(q)) return 20;
    return 0;
  }

  function runSearch() {
    const query = els.searchInput.value.trim();
    els.clearSearch.hidden = !query;

    if (!query) {
      closeSearch();
      els.searchCount.textContent = DATA.counts.places + " 座";
      els.searchHint.textContent = "也可以直接点击地图上的省份与城市";
      return;
    }

    const matches = DATA.cities
      .map((city) => ({ city, score: matchScore(city, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.city.name.localeCompare(b.city.name, "zh-Hans-CN");
      })
      .map((entry) => entry.city);

    state.searchItems = matches.slice(0, 8);
    state.searchTotal = matches.length;
    state.searchActive = -1;
    els.searchCount.textContent = matches.length + " 个结果";
    els.searchHint.textContent = matches.length
      ? "↑↓ 选择 · Enter 前往"
      : "没有找到匹配的城市";

    renderSearchResults(query);
  }

  function renderSearchResults(query) {
    els.searchResults.innerHTML = "";
    els.searchResults.hidden = false;
    els.searchInput.setAttribute("aria-expanded", "true");

    if (!state.searchItems.length) {
      const empty = document.createElement("div");
      empty.className = "search-no-result";
      empty.textContent = "没有找到「" + query + "」";
      const hint = document.createElement("span");
      hint.style.display = "block";
      hint.style.marginTop = "4px";
      hint.textContent = "试试城市名或省份名，例如「苏州」「云南」。";
      empty.appendChild(hint);
      els.searchResults.appendChild(empty);
      return;
    }

    state.searchItems.forEach((city, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-item";
      button.id = "search-option-" + index;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", "false");

      const main = document.createElement("span");
      main.className = "search-item-main";

      const name = document.createElement("span");
      name.className = "search-item-name";
      name.textContent = city.name;

      const meta = document.createElement("span");
      meta.className = "search-item-meta";
      meta.textContent = city.province + " · " + city.type;

      const arrow = document.createElement("span");
      arrow.className = "search-item-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "↗";

      main.appendChild(name);
      main.appendChild(meta);
      button.appendChild(main);
      button.appendChild(arrow);

      button.addEventListener("mouseenter", () => setSearchActive(index));
      button.addEventListener("click", () => {
        resetSearch();
        chooseCity(city);
      });

      els.searchResults.appendChild(button);
    });
  }

  function setSearchActive(index) {
    state.searchActive = index;
    const items = els.searchResults.querySelectorAll(".search-item");
    items.forEach((item, itemIndex) => {
      const active = itemIndex === index;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (index >= 0 && items[index]) {
      els.searchInput.setAttribute("aria-activedescendant", items[index].id);
      items[index].scrollIntoView({ block: "nearest" });
    } else {
      els.searchInput.removeAttribute("aria-activedescendant");
    }
  }

  function closeSearch() {
    els.searchResults.hidden = true;
    els.searchInput.setAttribute("aria-expanded", "false");
    els.searchInput.removeAttribute("aria-activedescendant");
    state.searchActive = -1;
  }

  function resetSearch() {
    els.searchInput.value = "";
    els.clearSearch.hidden = true;
    state.searchItems = [];
    state.searchTotal = 0;
    state.searchActive = -1;
    closeSearch();
    els.searchCount.textContent = DATA.counts.places + " 座";
    els.searchHint.textContent = "也可以直接点击地图上的省份与城市";
    els.searchInput.blur();
  }

  /* ------------------------------------------------------------------ */
  /* events                                                              */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    els.drawBtn.addEventListener("click", () => startDraw(DATA.cities));

    els.provinceDraw.addEventListener("click", () => {
      if (state.mode !== "province") return;
      const pool = citiesByProvince.get(state.provinceCode) || [];
      startDraw(pool);
    });

    els.sanshaChip.addEventListener("click", () => {
      const city = cityById.get("460300");
      if (city) chooseCity(city);
    });

    els.crumbChina.addEventListener("click", (event) => {
      event.preventDefault();
      if (state.mode === "china") {
        renderMap();
      } else {
        goNational();
      }
    });

    els.brandHome.addEventListener("click", (event) => {
      event.preventDefault();
      goNational();
    });

    els.zoomIn.addEventListener("click", () => zoomBy(1.28));
    els.zoomOut.addEventListener("click", () => zoomBy(1 / 1.28));
    els.resetView.addEventListener("click", () => {
      renderMap();
      showToast("视图已重置");
    });

    els.searchInput.addEventListener("input", runSearch);
    els.searchInput.addEventListener("focus", () => {
      if (els.searchInput.value.trim()) runSearch();
    });
    els.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        if (els.searchResults.hidden) {
          if (els.searchInput.value.trim()) runSearch();
          return;
        }
        event.preventDefault();
        if (!state.searchItems.length) return;
        setSearchActive((state.searchActive + 1) % state.searchItems.length);
      } else if (event.key === "ArrowUp") {
        if (els.searchResults.hidden) return;
        event.preventDefault();
        if (!state.searchItems.length) return;
        setSearchActive(
          (state.searchActive - 1 + state.searchItems.length) % state.searchItems.length
        );
      } else if (event.key === "Enter") {
        if (!state.searchItems.length) return;
        event.preventDefault();
        const index = state.searchActive >= 0 ? state.searchActive : 0;
        const city = state.searchItems[index];
        resetSearch();
        chooseCity(city);
      } else if (event.key === "Escape") {
        if (!els.searchResults.hidden) {
          event.preventDefault();
          closeSearch();
        } else {
          resetSearch();
        }
      }
    });

    els.clearSearch.addEventListener("click", () => {
      resetSearch();
      els.searchInput.focus();
    });

    document.addEventListener("pointerdown", (event) => {
      if (!els.searchBox.parentElement.contains(event.target)) {
        closeSearch();
      }
    });

    els.clearHistory.addEventListener("click", () => {
      state.recent = [];
      saveRecent();
      renderHistory();
      showToast("足迹已清空");
    });

    els.result.addEventListener("click", (event) => {
      const favoriteButton = event.target.closest("[data-favorite-status]");
      if (favoriteButton && state.selected) {
        toggleFavorite(state.selected, favoriteButton.dataset.favoriteStatus);
        return;
      }
      if (event.target.closest("#shareResultBtn")) {
        openShare();
      }
    });

    document.querySelectorAll("[data-favorite-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.favoriteTab = button.dataset.favoriteTab;
        renderFavorites();
      });
    });

    els.shareNativeBtn.addEventListener("click", shareCard);
    els.saveShareBtn.addEventListener("click", downloadShare);
    els.closeShare.addEventListener("click", closeShare);
    els.shareModal.addEventListener("click", (event) => {
      if (event.target === els.shareModal) closeShare();
    });

    els.aboutBtn.addEventListener("click", openAbout);
    els.closeAbout.addEventListener("click", closeAbout);
    els.aboutModal.addEventListener("click", (event) => {
      if (event.target === els.aboutModal) closeAbout();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!els.shareModal.hidden) {
        closeShare();
      } else if (!els.aboutModal.hidden) {
        closeAbout();
      }
    });

    window.addEventListener("resize", () => {
      if (chart) chart.resize();
    });

    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => {
        if (chart) chart.resize();
      });
      observer.observe(els.mapStage);
    }
  }

  function zoomBy(factor) {
    if (!chart) return;
    const option = chart.getOption();
    const geo = option && option.geo && option.geo[0];
    const current = geo && typeof geo.zoom === "number" ? geo.zoom : 1;
    const next = Math.min(10, Math.max(0.6, current * factor));
    chart.setOption({ geo: { id: "main-geo", zoom: next } });
  }

  function openAbout() {
    els.aboutModal.hidden = false;
    els.closeAbout.focus();
  }

  function closeAbout() {
    els.aboutModal.hidden = true;
    els.aboutBtn.focus();
  }

  /* ------------------------------------------------------------------ */
  /* init                                                                */
  /* ------------------------------------------------------------------ */

  function handleNativeBack() {
    if (!els.shareModal.hidden) {
      closeShare();
      return true;
    }
    if (!els.aboutModal.hidden) {
      closeAbout();
      return true;
    }
    if (!els.searchResults.hidden) {
      closeSearch();
      return true;
    }
    if (state.drawing) {
      cancelDraw();
      return true;
    }
    if (state.mode === "province") {
      goNational();
      return true;
    }
    return false;
  }

  function init() {
    window.handleNativeBack = handleNativeBack;
    ensureChinaMap();
    chart = echarts.init(els.map, null, { renderer: "canvas" });
    chart.on("click", onMapClick);

    els.placeCount.textContent = DATA.counts.places;
    els.drawCount.textContent = DATA.counts.places;
    els.searchCount.textContent = DATA.counts.places + " 座";

    bindEvents();
    renderAll();
  }

  init();
})();
