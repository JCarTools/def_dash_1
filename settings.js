(function (global) {
  "use strict";
  const KEY = "j-instrument-settings-v1";
  const defaults = { theme: "dark", accent: "ice", brightness: 100, speedMax: 240, rpmMax: 8000,
    redline: 6000, pollMs: 100, map: true, mapFit: "cover", smoothing: true, demo: false };
  function normalize(input) {
    const out = { ...defaults, ...input };
    out.theme = ["dark", "light"].includes(out.theme) ? out.theme : "dark";
    out.accent = ["ice", "amber", "white"].includes(out.accent) ? out.accent : "ice";
    for (const [key, allowed] of Object.entries({ speedMax: [180, 220, 240, 260], rpmMax: [6000, 8000], pollMs: [100, 200, 400] }))
      out[key] = allowed.includes(Number(out[key])) ? Number(out[key]) : defaults[key];
    out.brightness = Math.max(40, Math.min(100, Number(out.brightness) || 100));
    out.redline = Math.max(3000, Math.min(out.rpmMax, Number(out.redline) || 6000));
    out.mapFit = out.mapFit === "contain" ? "contain" : "cover";
    for (const key of ["map", "smoothing", "demo"]) out[key] = typeof out[key] === "boolean" ? out[key] : defaults[key];
    return out;
  }
  function load() { try { return normalize(JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (_) { return { ...defaults }; } }
  function save(value) { const settings = normalize(value); try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (_) { return false; }
    global.dispatchEvent(new CustomEvent("dashboard-settings", { detail: settings })); return true; }
  function field(label, name, options, note) { return `<label class="setting"><span>${label}</span><select name="${name}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select>${note ? `<small>${note}</small>` : ""}</label>`; }
  function mount(root, standalone = false) {
    if (!root) return;
    root.innerHTML = `<form class="settings-shell"><div class="settings-head"><div><span class="eyebrow">J · PERSONAL COCKPIT</span><h2 id="settingsTitle">Ваша приборная панель</h2><p>Настройте отображение под себя</p></div>${standalone ? "" : '<button type="button" class="close-settings" aria-label="Закрыть">×</button>'}</div><div class="settings-grid">`
      + field("Оформление", "theme", [["dark", "Ночное · графит"], ["light", "Дневное · серебро"]])
      + field("Акцент", "accent", [["ice", "Ледяной голубой"], ["amber", "Тёплый янтарь"], ["white", "Платиновый белый"]])
      + `<label class="setting"><span>Яркость панели <output id="brightnessOutput"></output></span><input name="brightness" type="range" min="40" max="100" step="5"></label>`
      + field("Частота быстрых показателей", "pollMs", [[100, "100 мс · плавно"], [200, "200 мс · сбалансированно"], [400, "400 мс · экономно"]], "Интервал после ответа. Одновременно выполняется один запрос.")
      + field("Шкала скорости", "speedMax", [[180,"180 км/ч"],[220,"220 км/ч"],[240,"240 км/ч"],[260,"260 км/ч"]])
      + field("Шкала оборотов", "rpmMax", [[6000,"6 000 об/мин"],[8000,"8 000 об/мин"]])
      + `<label class="setting"><span>Красная зона, об/мин</span><input name="redline" type="number" min="3000" max="8000" step="500"></label>`
      + field("Масштаб мини-карты", "mapFit", [["cover","Заполнить область"],["contain","Показать кадр целиком"]])
      + `<label class="setting toggle"><span>Мини-карта в центре</span><input name="map" type="checkbox"></label><label class="setting toggle"><span>Плавные стрелки</span><input name="smoothing" type="checkbox"></label><label class="setting toggle"><span>Демонстрационный режим</span><input name="demo" type="checkbox"></label></div><div class="settings-notice">Настройки сохраняются на этом устройстве. Демо предназначено для предпросмотра и автоматически отключается в автомобиле. В блоке шин отображаются только предупреждения, без значений давления.</div><div class="settings-footer"><button type="submit">Сохранить настройки</button><button type="button" class="secondary reset-settings">Сбросить</button>${standalone ? '<a href="index.html">К приборке</a>' : ''}<span class="save-status" role="status"></span></div></form>`;
    const form = root.querySelector("form");
    function fill(settings) { for (const key of Object.keys(defaults)) { const el = form.elements.namedItem(key); if (!el) continue; if (el.type === "checkbox") el.checked = settings[key]; else el.value = settings[key]; } form.querySelector("output").textContent = settings.brightness + "%"; }
    fill(load());
    form.elements.brightness.addEventListener("input", e => form.querySelector("output").textContent = e.target.value + "%");
    form.addEventListener("submit", e => { e.preventDefault(); const value = {}; for (const key of Object.keys(defaults)) { const el = form.elements.namedItem(key); value[key] = el.type === "checkbox" ? el.checked : el.value; } const ok = save(value); fill(normalize(value)); form.querySelector(".save-status").textContent = ok ? "Настройки сохранены" : "Не удалось сохранить настройки"; });
    form.querySelector(".reset-settings").addEventListener("click", () => { const ok = save(defaults); fill(defaults); form.querySelector(".save-status").textContent = ok ? "Настройки сброшены" : "Хранилище недоступно"; });
    const close = form.querySelector(".close-settings"); if (close) close.addEventListener("click", () => root.closest("dialog").close());
  }
  global.DashSettings = Object.freeze({ load, save, normalize, mount });
  if (document.body.classList.contains("settings-page")) mount(document.getElementById("settingsRoot"), true);
})(window);
