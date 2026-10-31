(function () {
  "use strict";
  const TOKEN = "SECURE_TOKEN_2025";
  const $ = id => document.getElementById(id);
  const state = Object.create(null), shown = { speed: 0, rpm: 0 };
  let settings = DashSettings.load(), bridge = null, api = null, subscribed = false, mapLoading = false;
  let mapLastTimestamp = -Infinity, mapSeen = 0, mapGeneration = 0, status = "waiting", lastFrame = 0, lastPaint = 0;
  const params = new URLSearchParams(location.search);
  const previewDemo = params.get("demo") === "1";
  let fixedPreview = params.has("speed") || params.has("rpm");
  let wasDemoMode = false;
  const palette = { ice: ["#69daef", "105,218,239"], amber: ["#e7b878", "231,184,120"], white: ["#dce9f3", "220,233,243"] };
  function number(...values) { for (const value of values) { if (value === null || value === undefined || value === "" || typeof value === "boolean") continue; const n = Number(value); if (Number.isFinite(n)) return n; } return null; }
  function boolean(value) { if (value === true || value === 1 || value === "1") return true; if (value === false || value === 0 || value === "0") return false; return null; }
  function parse(value) { if (typeof value === "string") { try { return JSON.parse(value); } catch (_) { return null; } } return value && typeof value === "object" ? value : null; }
  function point(angle, radius) { const rad = angle * Math.PI / 180; return [250 + Math.sin(rad) * radius, 250 - Math.cos(rad) * radius]; }
  function arc(from, to, radius) { const a = point(from, radius), b = point(to, radius); return `M${a[0]},${a[1]} A${radius},${radius} 0 ${to-from > 180 ? 1 : 0} 1 ${b[0]},${b[1]}`; }
  function buildGauge(id, max, rpm) {
    const svg = $(id).querySelector("svg"), prefix = rpm ? "r" : "s";
    let html = `<defs><radialGradient id="${prefix}face"><stop offset="0" stop-color="#172530"/><stop offset=".75" stop-color="#0c151d"/><stop offset="1" stop-color="#060c11"/></radialGradient><linearGradient id="${prefix}rim" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#31424e"/><stop offset=".25" stop-color="#141e27"/><stop offset=".55" stop-color="#071017"/><stop offset="1" stop-color="#3a4c59"/></linearGradient></defs><circle class="dial-rim" cx="250" cy="250" r="239" style="fill:url(#${prefix}rim)"/><circle class="dial-face" cx="250" cy="250" r="231" style="${settings.theme === "light" ? "fill:#e9eff3" : `fill:url(#${prefix}face)`}"/><circle cx="250" cy="250" r="224" fill="none" stroke="#748b9b" stroke-opacity=".08"/><path class="dial-track" d="${arc(-135, 135, 213)}"/>`;
    const steps = rpm ? max / 200 : max / 5, majorEvery = rpm ? 5 : 4;
    for (let i = 0; i <= steps; i++) {
      const value = max * i / steps, angle = -135 + 270 * i / steps, major = i % majorEvery === 0;
      const hot = rpm && value >= settings.redline;
      const a = point(angle, 202), b = point(angle, major ? 185 : 194);
      html += `<line class="dial-tick ${major ? "major" : ""} ${hot ? "hot" : ""}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
      if (major) { const p = point(angle, 163); html += `<text class="dial-label ${hot ? "hot" : ""}" x="${p[0]}" y="${p[1]}">${rpm ? value / 1000 : Math.round(value)}</text>`; }
    }
    if (rpm && settings.redline < max) html += `<path class="dial-red" d="${arc(-135 + 270*settings.redline/max, 135, 213)}"/>`;
    html += `<path class="dial-progress" id="${prefix}Progress" d="${arc(-135,-134.99,213)}"/><g class="needle" id="${prefix}Needle" transform="rotate(-135 250 250)"><line x1="250" y1="270" x2="250" y2="69"/><circle cx="250" cy="250" r="10"/><circle cx="250" cy="250" r="3" fill="#b4cbd8"/></g>`;
    svg.innerHTML = html;
  }
  function receive(key, payload) {
    const data = parse(payload); if (!data || data.error || data.IS_NULL === true || data.available === false || data.success === false) return;
    let value;
    switch (key) {
      case "speed": value = number(data.value, data.speed); if (value === null || value < 0 || value > 400) return; break;
      case "rpm": value = number(data.value, data.rpm); if (value === null || value < 0 || value > 12000) return; break;
      case "fuel": value = number(data.percent, data.value); if (value === null || value < 0 || value > 100) return; break;
      case "battery": value = number(data.batteryVoltage, data.value); if (value === null || value <= 0 || value > 40) return; break;
      case "outTemp": value = number(data.outTemp, data.value); if (value === null || value < -60 || value > 80) return; break;
      default: value = data;
    }
    state[key] = { value, data, received: Date.now() };
  }
  function fresh(key, ttl = 12000) { const item = state[key]; return item && Date.now()-item.received < ttl ? item : null; }
  function clearMap() { mapGeneration++; mapLoading = false; mapSeen = 0; mapLastTimestamp = -Infinity; $("mapImage").hidden = true; $("mapLive").hidden = true; $("mapImage").removeAttribute("src"); }
  function mapSubscription(enable) {
    if (!api || enable === subscribed) return;
    try {
      if (enable && typeof api.subscribeMiniMap === "function") {
        if (typeof api.setMiniMapTheme === "function") api.setMiniMapTheme(TOKEN, settings.theme === "light" ? "day" : "night");
        const result = parse(api.subscribeMiniMap(TOKEN)); subscribed = !result || !result.error;
      } else if (!enable && typeof api.unsubscribeMiniMap === "function") { api.unsubscribeMiniMap(TOKEN); subscribed = false; clearMap(); }
    } catch (_) { subscribed = false; }
  }
  function mapFrame(data) {
    if (!settings.map || document.hidden || mapLoading || !data) return;
    const src = data.image || data.src || data.frame, timestamp = Number(data.timestamp);
    if (typeof src !== "string" || !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(src) || src.length > 12*1024*1024 || !Number.isFinite(timestamp) || timestamp <= mapLastTimestamp) return;
    const img = $("mapImage"), generation = mapGeneration; mapLoading = true;
    img.onload = () => { if (generation !== mapGeneration) return; mapLoading = false; mapLastTimestamp = timestamp; mapSeen = Date.now(); img.hidden = false; $("mapLive").hidden = false; $("demoMap").toggleAttribute("hidden", true); };
    img.onerror = () => { if (generation === mapGeneration) { mapLoading = false; img.hidden = true; $("mapLive").hidden = true; } };
    img.src = src;
  }
  function hud(data) {
    if (!data) return;
    if (data.naviOn === false && data.aradarOn !== true) { $("navDistance").textContent = "Маршрут не задан"; $("navRoad").textContent = "Навигационные подсказки"; $("navLimit").hidden = true; return; }
    const distance = number(data.turnDist, data.turnDistance);
    if (distance !== null && distance >= 0) $("navDistance").textContent = distance >= 1000 ? `${(distance/1000).toFixed(1)} км` : `${Math.round(distance)} м`;
    if (typeof data.nextRoad === "string") $("navRoad").textContent = data.nextRoad || "Следуйте по маршруту";
    const type = number(data.turnType); $("navSymbol").textContent = [2,4,6].includes(type) ? "↰" : [3,5,7].includes(type) ? "↱" : [8,19].includes(type) ? "↶" : type === 15 ? "⚑" : "↑";
    const limit = number(data.speedLimit); $("navLimit").hidden = limit === null || limit <= 0; if (limit !== null) $("navLimit").textContent = Math.round(limit);
  }
  window.onAndroidEvent = function (type, payload) {
    const data = parse(payload);
    if (type === "carResponse") { if (bridge) bridge.receive(data); return; }
    if (type === "miniMapFrame") { mapFrame(data); return; }
    if (type === "hud") { hud(data); return; }
    const aliases = { speed:"speed", rpm:"rpm", fuel:"fuel", fuelPercent:"fuel", highBeam:"highBeam", turnSignals:"turnSignals", outTemp:"outTemp", battery:"battery", tpms:"tpms" };
    if (aliases[type] && !document.hidden) receive(aliases[type], data);
  };
  function attachAndroid() {
    if (api || !window.androidApi) return;
    api = window.androidApi; fixedPreview = false; for (const key of Object.keys(state)) delete state[key]; shown.speed = shown.rpm = 0; clearMap();
    bridge = new CarBridge({ api, token: TOKEN, fastMs: settings.pollMs, onData: receive, onStatus: value => { status = value; } });
    try { if (typeof api.onJsReady === "function") api.onJsReady(TOKEN); } catch (_) {}
    if (!document.hidden) { bridge.start(); mapSubscription(settings.map); }
  }
  function applySettings(value) {
    settings = value; const [accent, rgb] = palette[settings.accent];
    document.documentElement.style.setProperty("--accent", accent); document.documentElement.style.setProperty("--accent-rgb", rgb);
    document.documentElement.style.setProperty("--brightness", settings.brightness/100);
    document.body.classList.toggle("light", settings.theme === "light");
    $("mapCard").classList.toggle("contain", settings.mapFit === "contain"); $("dashboard").classList.toggle("map-disabled", !settings.map);
    $("mapPlaceholderTitle").textContent = settings.map ? "Ваш маршрут — в центре" : "Мини-карта отключена";
    $("mapPlaceholderText").textContent = settings.map ? "Карта появится после подключения навигации" : "Включите карту в настройках панели";
    buildGauge("speedGauge", settings.speedMax, false); buildGauge("rpmGauge", settings.rpmMax, true);
    if (bridge) bridge.setInterval(settings.pollMs);
    if (!settings.map) clearMap();
    if (api) { mapSubscription(settings.map && !document.hidden); try { if (subscribed && typeof api.setMiniMapTheme === "function") api.setMiniMapTheme(TOKEN, settings.theme === "light" ? "day" : "night"); } catch (_) {} }
  }
  function renderDetails() {
    const fuel = fresh("fuel"), battery = fresh("battery"), temp = fresh("outTemp", 20000), turns = fresh("turnSignals", 2000), beam = fresh("highBeam",3000), tpms = fresh("tpms");
    $("fuelValue").textContent = fuel ? Math.round(fuel.value) : "—"; $("fuelBar").style.width = `${fuel ? fuel.value : 0}%`;
    const reserve = fuel && (fuel.data.lowFuelWarningValid === true ? boolean(fuel.data.lowFuelWarning ?? fuel.data.reserve) === true : fuel.value <= 10);
    $("reserve").hidden = !reserve; $("fuelValue").classList.toggle("warn-text", !!reserve);
    $("batteryValue").textContent = battery ? battery.value.toFixed(1) : "—"; $("tempValue").textContent = temp ? Math.round(temp.value) : "—";
    $("turnLeft").classList.toggle("active", !!turns && turns.data.leftValid !== false && boolean(turns.data.left ?? turns.data.leftValue) === true);
    $("turnRight").classList.toggle("active", !!turns && turns.data.rightValid !== false && boolean(turns.data.right ?? turns.data.rightValue) === true);
    $("highBeam").classList.toggle("active", !!beam && boolean(beam.data.highBeam ?? beam.data.active ?? beam.data.value) === true);
    let known = 0, warnings = 0;
    ["fl", "fr", "rl", "rr"].forEach((wheel, index) => { const warning = tpms ? number(tpms.data[wheel+"Warning"]) : null; const valid = warning === 0 || warning === 1; if (valid) known++; if (warning === 1) warnings++; const dot = $("wheelDots").children[index]; dot.className = valid ? warning ? "warn" : "ok" : ""; });
    $("tpmsValue").textContent = warnings ? `Предупреждений: ${warnings}` : known === 4 ? "Без предупреждений" : "Нет данных";
    $("tpmsValue").classList.toggle("warn-text", warnings > 0);
    const now = new Date(); $("clock").textContent = now.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"}); $("dateLabel").textContent = now.toLocaleDateString("ru-RU",{day:"numeric",month:"long"});
    const demo = !api && (previewDemo || settings.demo || fixedPreview); $("demoLabel").hidden = !demo;
    $("demoMap").toggleAttribute("hidden", !demo || !settings.map);
    if (mapSeen && Date.now()-mapSeen > 10000) { $("mapImage").hidden = true; $("mapLive").hidden = true; }
    const speed = fresh("speed",2000), rpm = fresh("rpm",2000), live = !!speed && !!rpm;
    const text = demo ? "ДЕМОНСТРАЦИЯ" : status === "timeout" ? "НЕТ ОТВЕТА" : live ? "ДАННЫЕ АВТОМОБИЛЯ" : api ? "ОЖИДАНИЕ ДАННЫХ" : "НЕТ ПОДКЛЮЧЕНИЯ";
    $("connection").className = `connection ${live ? "live" : api ? "warning" : ""}`; $("connection").querySelector("span").textContent = text;
    $("dataHint").textContent = demo ? "Демо · синтетические показания" : status === "timeout" ? "Запрос задержан · повторы приостановлены до ответа" : !api ? "Откройте в JCarTools · для предпросмотра добавьте ?demo=1" : live ? `Профиль J · асинхронное чтение · интервал ${settings.pollMs} мс` : "Ожидание актуальных ответов профиля J";
  }
  function frame(time) {
    const dt = lastFrame ? Math.min((time-lastFrame)/1000,.1) : .016; lastFrame = time;
    const demo = !api && (previewDemo || settings.demo || fixedPreview);
    if (wasDemoMode && !demo) { for (const key of Object.keys(state)) delete state[key]; shown.speed = shown.rpm = 0; clearMap(); $("navDistance").textContent = "Маршрут не задан"; $("navRoad").textContent = "Навигационные подсказки"; }
    wasDemoMode = demo;
    if (demo) {
      const phase = time/1000;
      receive("speed",{value:fixedPreview ? number(params.get("speed")) ?? 96 : 86+22*Math.sin(phase/7)});
      receive("rpm",{value:fixedPreview ? number(params.get("rpm")) ?? 2350 : 2300+700*Math.sin(phase/7+.3)});
      receive("fuel",{percent:64}); receive("battery",{value:14.2}); receive("outTemp",{value:12}); receive("tpms",{flWarning:0,frWarning:0,rlWarning:0,rrWarning:0});
      if (!fixedPreview) { $("navDistance").textContent="350 м"; $("navRoad").textContent="Демонстрационный маршрут"; $("navSymbol").textContent="↱"; }
    }
    const smooth = settings.smoothing && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const [key,prefix,max] of [["speed","s",settings.speedMax],["rpm","r",settings.rpmMax]]) {
      const item = fresh(key,2000), target = item ? item.value : 0;
      shown[key] += (target-shown[key]) * (smooth ? 1-Math.exp(-12*dt) : 1);
      const angle = -135+270*Math.max(0,Math.min(1,shown[key]/max));
      const needle = $(prefix+"Needle"); if (needle) needle.setAttribute("transform",`rotate(${angle} 250 250)`);
      const progress = $(prefix+"Progress"); if (progress) progress.setAttribute("d",arc(-135,Math.max(-134.99,angle),213));
      $(key+"Value").textContent = item ? key === "rpm" ? String(Math.round(item.value/10)*10) : String(Math.round(item.value)) : "—";
    }
    if (time-lastPaint > 150) { renderDetails(); lastPaint=time; }
    requestAnimationFrame(frame);
  }
  DashSettings.mount($("settingsRoot"));
  $("settingsButton").addEventListener("click",() => { DashSettings.mount($("settingsRoot")); $("settingsDialog").showModal(); });
  $("settingsDialog").addEventListener("click",e => { if(e.target === $("settingsDialog")) $("settingsDialog").close(); });
  window.addEventListener("dashboard-settings",e => applySettings(e.detail));
  window.addEventListener("storage",() => applySettings(DashSettings.load()));
  document.addEventListener("visibilitychange",() => { if (document.hidden) { if(bridge) bridge.stop(); mapSubscription(false); } else { attachAndroid(); if(bridge) bridge.start(); mapSubscription(settings.map); } });
  window.addEventListener("pagehide",() => { if(bridge) bridge.stop(); mapSubscription(false); });
  applySettings(settings); attachAndroid(); renderDetails(); requestAnimationFrame(frame);
  setInterval(attachAndroid,1000);
})();
