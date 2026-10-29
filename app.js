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
  }

  /* ------------------------------------------------------------------ */
  /* result panel                                                        */
  /* ------------------------------------------------------------------ */

  function renderResult() {
    if (state.drawing) return;

    if (state.selected) {
      const city = state.selected;
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

    els.aboutBtn.addEventListener("click", openAbout);
    els.closeAbout.addEventListener("click", closeAbout);
    els.aboutModal.addEventListener("click", (event) => {
      if (event.target === els.aboutModal) closeAbout();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !els.aboutModal.hidden) {
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

  function init() {
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
