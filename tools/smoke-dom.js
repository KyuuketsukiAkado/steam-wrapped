"use strict";

/* DOM-дымовой тест: исполняет скрипты страницы в jsdom со стабами
   IntersectionObserver / matchMedia / fetch и проверяет, что:
     • app.js выполняется без исключений (ловит ReferenceError уровня модуля,
       которые не видит node --check — например, обращение из chrome()
       к хелперам из скоупа boot());
     • scroll-reveal вешается на все запланированные блоки и срабатывает
       при «скролле»;
     • при prefers-reduced-motion контент не прячется.

   Запуск: node tools/smoke-dom.js
   Требует jsdom один раз: npm i jsdom (в корне проекта; node_modules
   в .gitignore). Тест не трогает сеть: rules.json читается с диска. */

let JSDOM;
try {
  JSDOM = require("jsdom").JSDOM;
} catch (e) {
  console.error("Не найден jsdom. Установи один раз: npm i jsdom");
  process.exit(1);
}
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function makeWindow(reducedMotion) {
  const dom = new JSDOM(read("index.html"), {
    url: "http://localhost/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const w = dom.window;
  const regs = [];
  w.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(n) { regs.push({ cb: this.cb, node: n }); }
    unobserve() {} disconnect() {}
  };
  w.matchMedia = function (q) {
    return {
      matches: q.indexOf("prefers-reduced-motion") >= 0 ? reducedMotion : false,
      media: q, addEventListener() {}, removeEventListener() {}
    };
  };
  const rules = JSON.parse(read("assets/data/rules.json"));
  w.fetch = function () {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(rules) });
  };
  // jsdom без пакета canvas отдаёт null из getContext — редатор карточки
  // (redrawCard) честно рассчитывает на 2D-контекст. Подсовываем «всеядную»
  // заглушку: любой метод вызывается и возвращает её же, любое свойство
  // существует, measureText возвращает число. Так дымовой тест проверяет
  // логику страницы, а не реализацию Canvas.
  var ctx;
  ctx = new Proxy(function () { return ctx; }, {
    get(target, prop) {
      if (prop === "measureText") return function () { return { width: 120 }; };
      if (prop === Symbol.toPrimitive) return function () { return 0; };
      return target;
    },
    set() { return true; },
    apply() { return ctx; }
  });
  w.HTMLCanvasElement.prototype.getContext = function () { return ctx; };
  return { w, regs };
}

function evalScripts(w) {
  ["assets/js/data.js", "assets/js/profile-data.js", "assets/js/app.js"]
    .forEach(function (src) { w.eval(read(src)); });
}

function tick(ms) {
  return new Promise(function (r) { setTimeout(r, ms || 60); });
}

async function main() {
  // --- Сценарий 1: обычный браузер --------------------------------------
  {
    const { w, regs } = makeWindow(false);
    evalScripts(w);                       // исключение здесь = сломан модуль
    await tick();                         // даём boot() отработать после fetch
    const doc = w.document;
    const q = (s) => doc.querySelectorAll(s);

    assert.equal(q(".sec-head.reveal-wait.reveal-luxe").length, 7,
      "все 7 заголовков секций ждут luxe-reveal");
    assert.ok(q(".bar.reveal-wait").length >= 10, "строки топа подвешены");
    assert.ok(q(".fact.reveal-wait").length > 0, "факты подвешены");
    assert.ok(q(".legend__row.reveal-wait").length > 0, "легенда жанров подвешена");
    assert.equal(q(".fate__slot.reveal-wait").length, 3, "слоты судьбы подвешены");
    assert.ok(doc.querySelector(".soulmate > div.reveal-luxe"),
      "левая колонка soulmate — luxe");
    assert.equal(q(".share > div.reveal-luxe").length, 2, "обе колонки шаринга — luxe");
    assert.ok(doc.querySelector(".footer__big.reveal-luxe"), "футер — luxe");

    const seg = doc.querySelector(".donut__seg");
    assert.ok(seg && seg.dataset.arc, "донут подготовлен к развороту");

    // «Скроллим»: все наблюдатели сообщают о входе в вьюпорт.
    for (const r of regs) r.cb([{ target: r.node, isIntersecting: true }], {});

    assert.equal(q(".reveal-wait").length, 0, "после скролла скрытых не осталось");
    assert.ok(q(".reveal-in").length > 0, "анимации появления запущены");
    const sd = seg.style.strokeDasharray || seg.style.getPropertyValue("stroke-dasharray");
    assert.ok(sd.indexOf(seg.dataset.arc) === 0,
      "дуга донута дорисована до финального значения");
    w.close();
  }

  // --- Сценарий 2: prefers-reduced-motion -------------------------------
  {
    const { w } = makeWindow(true);
    evalScripts(w);
    await tick();
    const doc = w.document;
    assert.equal(doc.querySelectorAll(".reveal-wait").length, 0,
      "при reduced-motion контент не прячется");
    const seg = doc.querySelector(".donut__seg");
    assert.ok(seg && !seg.dataset.arc, "донут без анимации — нарисован целиком");
    assert.ok(doc.querySelectorAll(".fact").length > 0, "контент отрисован");
    w.close();
  }

  console.log("✓ smoke-dom: app.js без ошибок, reveal вешается и срабатывает, reduced-motion уважается");
}

main().catch(function (e) {
  console.error(e && e.stack || e);
  process.exit(1);
});
