/* =========================================================
   STEAM WRAPPED — вся логика страницы.
   Данные приходят из assets/js/data.js (window.STEAM_DATA).
   ========================================================= */
(function () {
  "use strict";

  // Подгрузка без перезагрузки (задача 4): boot() может вызываться повторно.
  // bootSeq отменяет устаревшие асинхронные перерисовки (аватар, fonts.ready).
  var bootSeq = 0;

  // Versus: актуальные данные страницы (обновляются каждый boot).
  var currentPVD = null;

  /* Тема шаринг-карточки живёт вне boot: переживает смену профиля.
     redrawCardLive всегда указывает на redrawCard актуального boot. */
  var cardTheme = "dark";
  var redrawCardLive = null;
  Array.prototype.forEach.call(document.querySelectorAll(".theme-switch__btn"), function (b) {
    b.addEventListener("click", function () {
      cardTheme = b.getAttribute("data-card-theme") === "red" ? "red" : "dark";
      Array.prototype.forEach.call(document.querySelectorAll(".theme-switch__btn"), function (o) {
        o.classList.toggle("is-on", o === b);
        o.setAttribute("aria-pressed", o === b ? "true" : "false");
      });
      if (redrawCardLive) redrawCardLive();
    });
  });

  /* Вау: лёгкий 3D-наклон карточек за курсором. Делегирование — карточки
     перерендериваются boot'ом, прямые подписки слетели бы. Только точный
     указатель без reduced-motion; тач и клавиатура остаются со статикой. */
  if (window.matchMedia &&
      window.matchMedia("(pointer: fine)").matches &&
      window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
    var tiltCard = null;
    document.addEventListener("pointermove", function (ev) {
      var card = ev.target && ev.target.closest ? ev.target.closest(".stat, .rcard") : null;
      if (tiltCard && tiltCard !== card) {
        tiltCard.style.setProperty("--rx", "0deg");
        tiltCard.style.setProperty("--ry", "0deg");
      }
      tiltCard = card;
      if (!card) return;
      var r = card.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var px = (ev.clientX - r.left) / r.width - 0.5;
      var py = (ev.clientY - r.top) / r.height - 0.5;
      card.style.setProperty("--ry", (-px * 7).toFixed(2) + "deg");
      card.style.setProperty("--rx", (py * 7).toFixed(2) + "deg");
    });
    document.addEventListener("pointerleave", function () {
      if (tiltCard) {
        tiltCard.style.setProperty("--rx", "0deg");
        tiltCard.style.setProperty("--ry", "0deg");
        tiltCard = null;
      }
    });
  }

  // Страница рисуется из одного ProfileViewData: сейчас это статичный data.js,
  // позже сюда же придёт нормализованный ответ Worker для профиля друга.
  function boot(rules, profileViewData, isDemoProfile) {
    var dataLayer = window.SteamWrappedData;
    var D = profileViewData || window.STEAM_DATA;
    if (!D) { console.error("Нет данных: assets/js/data.js не загрузился"); return; }
    // Для исходного data.js сохраняем прежний путь нормализации. Данные,
    // полученные Worker, уже нормализованы через normalizeSteamData() до boot.
    if (dataLayer && !profileViewData) D = dataLayer.normalizeStaticData(D, rules);
    currentPVD = D;
    resetVersus();
    bootSeq += 1;
    var myBoot = bootSeq;

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- утилиты ---------- */

  var nf = new Intl.NumberFormat("ru-RU");
  function num(n) { return nf.format(Math.round(n)); }

  // склонение: plural(5, ['час','часа','часов'])
  function plural(n, forms) {
    n = Math.abs(Math.round(n)) % 100;
    var n1 = n % 10;
    if (n > 10 && n < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
  }

  function dec(n, d) {
    d = d === undefined ? 1 : d;
    return n.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  // Любая строка из Steam — внешние данные. Базовый конструктор всегда
  // вставляет её как текст, а не как HTML: ник с «<...>» не станет разметкой.
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // Имя игры: ссылка на её страницу в Steam, если известен appid, иначе текст.
  function gameLabel(g) {
    if (g && g.appid) {
      var a = el("a", "game-link", g.name);
      a.target = "_blank";
      a.rel = "noopener";
      a.href = "https://store.steampowered.com/app/" + encodeURIComponent(g.appid) + "/";
      return a;
    }
    return document.createTextNode(g ? g.name : "");
  }

  function appendBold(parent, text) {
    parent.appendChild(el("b", "", text));
    return parent;
  }

  function setRichText(node, parts) {
    node.textContent = "";
    parts.forEach(function (part) {
      if (part && typeof part === "object" && part.bold !== undefined) appendBold(node, part.bold);
      else node.appendChild(document.createTextNode(String(part)));
    });
  }

  function parseDate(iso) {
    if (!iso) return null;
    // даты без времени парсим как локальный полдень, чтобы не уезжать на день
    // в зависимости от часового пояса зрителя
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    var d = m ? new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0) : new Date(iso);
    return isNaN(d) ? null : d;
  }

  function fmtDate(iso) {
    var d = parseDate(iso);
    if (!d) return "—";
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  }

  function daysAgo(iso) {
    var d = parseDate(iso);
    if (!d) return null;
    return Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000));
  }

  // 0.1 часа не должны превращаться в «0»: маленьким числам оставляем десятые
  function smartDec(n) {
    return dec(n, n >= 10 ? 0 : 1);
  }

  /* ---------- разбор данных ---------- */

  var games   = (D.games || []).slice().sort(function (a, b) { return b.hours - a.hours; });
  var played  = games.filter(function (g) { return g.hours > 0; });
  var backlog = games.filter(function (g) { return !g.hours; });
  var totals  = D.totals || {};

  var soulmate = (D.soulmateAppid && games.filter(function (g) { return g.appid === D.soulmateAppid; })[0]) || played[0];

  var totalHours = totals.hoursTotal != null
    ? totals.hoursTotal
    : played.reduce(function (s, g) { return s + g.hours; }, 0);

  var hours2w = totals.hoursTwoWeeks != null
    ? totals.hoursTwoWeeks
    : games.reduce(function (s, g) { return s + (g.hours2w || 0); }, 0);

  var gamesOwned = totals.gamesOwned != null ? totals.gamesOwned : games.length;
  var neverPlayed = totals.gamesNeverPlayed != null ? totals.gamesNeverPlayed : backlog.length;

  function getArchetype(totals, played, backlog, genreData, soulmate, totalHours, hours2w) {
    var gamesOwned = totals.gamesOwned || (played.length + backlog.length);
    var neverPlayed = totals.gamesNeverPlayed != null ? totals.gamesNeverPlayed : backlog.length;
    var topGenre = (genreData && genreData[0]) ? genreData[0].name : "";
    var leadShare = (soulmate && totalHours) ? (soulmate.hours / totalHours) : 0;

    if (hours2w >= 40) {
      return { title: "В активном рейде", desc: "Ударный темп игры за последние недели (" + Math.round(hours2w) + " ч)" };
    }
    if (leadShare >= 0.35 && soulmate) {
      return { title: "Марафонец одного мира", desc: "Более " + Math.round(leadShare * 100) + "% всего времени в " + soulmate.name };
    }
    if (neverPlayed >= 15 && gamesOwned > 0 && (neverPlayed / gamesOwned) >= 0.4) {
      return { title: "Хранитель бэклога", desc: Math.round(neverPlayed / gamesOwned * 100) + "% библиотеки ждёт своего часа" };
    }
    if (topGenre === "Стратегия" || topGenre === "Strategy") {
      return { title: "Ночной стратег", desc: "Главный фокус — тактика, расчёт и победа" };
    }
    if (topGenre === "RPG" || topGenre === "Ролевые игры") {
      return { title: "Ролевой исследователь", desc: "Сотни часов в глубоких мирах и сюжетах" };
    }
    if (topGenre === "Экшен" || topGenre === "Action" || topGenre === "Шутер") {
      return { title: "Адепт адреналина", desc: "Высокий темп, реакция и драйв" };
    }
    if (topGenre === "Инди" || topGenre === "Indie") {
      return { title: "Инди-эстет", desc: "Любовь к авторским и самобытным тайтлам" };
    }
    if (topGenre === "Гонки" || topGenre === "Racing" || topGenre === "Симулятор") {
      return { title: "Мастер симуляторов", desc: "Внимание к деталям, скорость и контроль" };
    }
    if (totalHours >= 3000) {
      return { title: "Ветеран Steam", desc: "Более " + num(totalHours) + " часов игрового опыта" };
    }
    if (played.length >= 40) {
      return { title: "Исследователь миров", desc: "Широкий кругозор и десятки пройденных историй" };
    }
    return { title: "Игровой энтузиаст", desc: "Сбалансированная библиотека и интерес к играм" };
  }
  var genreData = (function () {
    if (D.genreHours && D.genreHours.length) return D.genreHours.slice();
    var map = {};
    played.forEach(function (g) {
      var gs = (g.genres && g.genres.length) ? g.genres : ["Без жанра"];
      gs.forEach(function (name) {
        map[name] = (map[name] || 0) + g.hours / gs.length;
      });
    });
    var arr = Object.keys(map).map(function (k) { return { name: k, hours: map[k] }; })
                              .sort(function (a, b) { return b.hours - a.hours; });
    if (arr.length > 6) {
      var rest = arr.slice(6).reduce(function (s, x) { return s + x.hours; }, 0);
      arr = arr.slice(0, 6);
      if (rest > 0) arr.push({ name: "Прочее", hours: rest });
    }
    return arr;
  })();

  var arch = getArchetype(totals, played, backlog, genreData, soulmate, totalHours, hours2w);

  /* ---------- шапка ---------- */

  var profileName = D.meta.persona || "steam profile";
  document.title = "Steam Wrapped · " + (isDemoProfile ? "пример: " : "") + profileName;
  $("#year").textContent = new Date().getFullYear();
  $("#heroNick").textContent = profileName;
  var archEl = $("#heroArchetype");
  if (archEl) {
    archEl.textContent = arch.title;
    archEl.title = arch.desc;
    archEl.hidden = false;
  }
  $("#heroEyebrow").textContent =
    (D.meta.memberSince ? "в Steam с " + fmtDate(D.meta.memberSince) + " · " : "") +
    "данные от " + fmtDate(D.meta.generatedAt);


  var pl = $("#profileLink");
  if (D.meta.profileUrl) { pl.href = D.meta.profileUrl; pl.style.display = ""; }
  else pl.style.display = "none";

  var av = $("#avatar");
  if (D.meta.avatar) {
    var img = new Image();
    img.src = D.meta.avatar;
    img.alt = D.meta.persona || "avatar";
    img.onload = function () { if (myBoot !== bootSeq) return; av.textContent = ""; av.appendChild(img); };
    img.onerror = function () { if (myBoot !== bootSeq) return; av.textContent = (D.meta.persona || "?").charAt(0).toUpperCase(); };
  } else {
    av.textContent = (D.meta.persona || "?").charAt(0).toUpperCase();
  }

  var sourceBadge = $("#sourceBadge");
  sourceBadge.textContent = "источник данных: ";
  appendBold(sourceBadge, D.meta.source === "steam-api" ? "Steam Web API" :
    D.meta.source === "manual" ? "ручная сборка" : "образец");

  /* ---------- подсказки под главными цифрами ---------- */

  $("#hintGames").textContent = num(neverPlayed) + " " + plural(neverPlayed, ["игра ждёт", "игры ждут", "игр ждут"]) + " своего часа";
  $("#hintHours").textContent = "это " + dec(totalHours / 24, 0) + " " + plural(totalHours / 24, ["день", "дня", "дней"]) + " нон-стоп";
  $("#hint2w").textContent = "≈ " + dec(hours2w / 14, 1) + " ч в день";

  /* ---------- анимированные счётчики ---------- */

  var counters = {
    games: gamesOwned,
    hours: totalHours,
    hours2w: hours2w,
    smHours: soulmate ? soulmate.hours : 0
  };

  function animate(node, to) {
    var dur = 1200, t0 = null;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      node.textContent = num(to * eased);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  var counterObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      animate(e.target, counters[e.target.dataset.count] || 0);
      counterObserver.unobserve(e.target);
    });
  }, { threshold: 0.4 });

  $$("[data-count]").forEach(function (n) { counterObserver.observe(n); });

  /* ---------- бегущая строка ---------- */

  (function marquee() {
    var h = soulmate ? soulmate.hours : totalHours;
    var items = [
      num(gamesOwned) + " " + plural(gamesOwned, ["игра", "игры", "игр"]) + " в библиотеке",
      num(totalHours) + " " + plural(totalHours, ["час", "часа", "часов"]) + " всего",
      dec(totalHours / 24, 0) + " " + plural(totalHours / 24, ["день", "дня", "дней"]) + " нон-стоп",
      num(neverPlayed) + " " + plural(neverPlayed, ["игра", "игры", "игр"]) + " не запущены ни разу",
      soulmate ? soulmate.name + " — " + num(h) + " ч" : "",
      num(hours2w) + " " + plural(hours2w, ["час", "часа", "часов"]) + " за две недели",
      D.meta.memberSince ? "в Steam с " + new Date(D.meta.memberSince).getFullYear() + " года" : "",
      "и это только Steam"
    ].filter(Boolean);
    var marqueeNode = $("#marquee");
    marqueeNode.textContent = "";
    // Дубль нужен для бесшовной прокрутки. Создаём DOM-узлы, а не HTML-строку:
    // один из пунктов содержит имя игры, пришедшее от Steam.
    items.concat(items).forEach(function (text) {
      var item = el("span");
      item.appendChild(el("i", "", "✦"));
      item.appendChild(document.createTextNode(text));
      marqueeNode.appendChild(item);
    });
  })();

  /* ---------- 01 · главная игра жизни ---------- */

  // повторный boot: чистим динамические контейнеры, иначе строки задвоятся
  $("#facts").textContent = "";
  $("#smName").textContent = "—";
  $("#smShare").textContent = "—";
  var smArt = $("#smArt");
  if (smArt) {
    smArt.hidden = true;
    smArt.removeAttribute("src");
    smArt.onerror = function () { smArt.hidden = true; };
  }
  if (soulmate) {
    var h = soulmate.hours;

    // Правила лежат в общем rules.json: для своего и чужого профиля
    // пересчёт выбирается одинаково — AppID → название → жанр → fallback.
    var unit = dataLayer && dataLayer.soulmateUnit
      ? dataLayer.soulmateUnit(soulmate, rules)
      : { min: 120, word: "вечеров", note: "по два часа, от «на часик» до «ещё один»" };

    var smNameEl = $("#smName");
    smNameEl.textContent = "";
    smNameEl.appendChild(gameLabel(soulmate));
    if (smArt && soulmate.appid) {
      smArt.alt = soulmate.name;
      smArt.hidden = false;
      smArt.src = "https://cdn.cloudflare.steamstatic.com/steam/apps/" + soulmate.appid + "/header.jpg";
    }
    $("#smShare").textContent =
      "Это " + dec(h / totalHours * 100, 0) + "% всего времени в Steam. " +
      (soulmate.lastPlayed ? "Последний заход — " + fmtDate(soulmate.lastPlayed) + "." : "");

    var facts = [
      [dec(h / 24, 1),        [{ bold: "дней" }, " подряд, без сна, еды и уведомлений"]],
      [dec(h / 168, 1),       [{ bold: "рабочих месяцев" }, " по 40 часов в неделю"]],
      [dec(h / 8760 * 100, 1) + "%", ["календарного ", { bold: "года жизни" }]],
      [num(h / 11.4),         [{ bold: "трилогий «Властелин колец»" }, " в режиссёрской версии"]],
      [dec(h / 600, 1),       [{ bold: "иностранных языков" }, " до уверенного B2 (600 ч каждый)"]],
      [num(h * 5),            [{ bold: "километров" }, " пешком, если бы шёл вместо игры — это дальше, чем от Минска до Токио"]],
      [num(h * 60 / unit.min), [{ bold: unit.word }, " " + unit.note]],
      [dec(h / 3.5, 0),       [{ bold: "марафонов" }, " можно было бы пробежать (по 3,5 ч)"]]
    ];

    var fw = $("#facts");
    facts.forEach(function (f) {
      var row = el("div", "fact");
      row.appendChild(el("div", "fact__num", f[0]));
      var text = el("div", "fact__text");
      setRichText(text, f[1]);
      row.appendChild(text);
      fw.appendChild(row);
    });
  }

  /* ---------- 02 · топ игр ---------- */

  (function topGames() {
    var top = played.slice(0, 10);
    $("#bars").textContent = "";
    if (!top.length) return;
    var max = top[0].hours;
    var wrap = $("#bars");
    var ramp = ["#E10600", "#8E8E93", "#6E6E73", "#636366", "#48484E",
                "#3A3A3F", "#2F2F34", "#26262B", "#1F1F23", "#1A1A1E"];

    // два колосса почти вровень (Dota и CS2) — каждому свой оттенок красного,
    // чтобы второе место не выглядело безнадёжным
    var colossi = top.length > 1 && top[1].hours / top[0].hours >= 0.8;

    // хвост десятки — холодный графит, красный уже разобран
    var tail = ["#8E8E93", "#6E6E73", "#636366", "#48484E",
                "#3A3A3F", "#2F2F34", "#26262B", "#1F1F23"];
    var colors = top.map(function (g, i) {
      if (colossi && i === 0) return "#E10600";   // красный — лидер
      if (colossi && i === 1) return "#FF5A4D";   // горячий коралл — второй колосс
      return colossi ? tail[i - 2] : ramp[i];
    });

    // Подпись к секции считается на лету. Имена игр — внешние данные,
    // поэтому собираем текст узлами, а не склейкой HTML.
    var note = $("#topNote");
    if (note) {
      var topSum = top.reduce(function (s, g) { return s + g.hours; }, 0);
      var rest9 = topSum - top[0].hours;
      var leadShare = top[0].hours / topSum * 100;
      var parts;
      if (top[0].hours >= rest9) {
        parts = ["Одна игра забрала больше времени, чем остальные девять вместе — ",
          { bold: dec(leadShare, 0) + "%" }, " всей десятки. Длина полос — доля от лидера."];
      } else if (colossi) {
        parts = ["Два колосса почти вровень: ", { bold: top[0].name }, " и ",
          { bold: top[1].name }, " держат ",
          { bold: dec((top[0].hours + top[1].hours) / topSum * 100, 0) + "%" },
          " времени десятки. Дальше — уже про вкус, а не про привычку."];
      } else {
        parts = ["Лидер — только ", { bold: dec(leadShare, 0) + "%" },
          " десятки: время честно размазано по разным играм. Длина полос — доля от лидера."];
      }
      setRichText(note, parts);
    }

    top.forEach(function (g, i) {
      var isColossus = colossi && i < 2;
      var row = el("div", "bar" + (isColossus ? " bar--colossus" : ""));
      row.style.setProperty("--bc", colors[i]);
      // у колоссов полоса заливается своим цветом целиком: иначе градиент
      // уводил Доту в лёд CS2, и два акцента переставали различаться
      row.style.setProperty("--bc2", isColossus ? colors[i] : colors[(i + 1) % colors.length]);
      row.appendChild(el("div", "bar__rank", String(i + 1).padStart(2, "0")));

      var body = el("div", "bar__body");
      var titleRow = el("div", "bar__head");
      if (g.appid) {
        var thumb = el("img", "bar__thumb");
        thumb.src = "https://cdn.cloudflare.steamstatic.com/steam/apps/" + encodeURIComponent(g.appid) + "/header.jpg";
        thumb.alt = g.name || "";
        thumb.loading = "lazy";
        thumb.onerror = function () { thumb.style.display = "none"; };
        titleRow.appendChild(thumb);
      }
      var barName = el("div", "bar__name");
      barName.appendChild(gameLabel(g));
      titleRow.appendChild(barName);
      body.appendChild(titleRow);
      var track = el("div", "bar__track");
      var fill = el("div", "bar__fill");
      fill.dataset.w = (g.hours / max * 100).toFixed(2) + "%";
      track.appendChild(fill);
      body.appendChild(track);
      row.appendChild(body);

      var value = el("div", "bar__value", num(g.hours));
      value.appendChild(el("span", "", "ч"));
      row.appendChild(value);
      wrap.appendChild(row);
    });

    var barObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        $$(".bar__fill", wrap).forEach(function (f, i) {
          setTimeout(function () { f.style.width = f.dataset.w; }, i * 70);
        });
        barObserver.disconnect();
      });
    }, { threshold: 0.2 });
    barObserver.observe(wrap);
  })();

  /* ---------- 03 · чем занимаюсь сейчас ---------- */

  (function recent() {
    var wrap = $("#recent");
    wrap.textContent = "";
    wrap.classList.remove("is-single");
    var list = games.filter(function (g) { return (g.hours2w || 0) > 0; })
                    .sort(function (a, b) { return b.hours2w - a.hours2w; })
                    .slice(0, 4);

    if (!list.length) {
      list = played.slice()
        .filter(function (g) { return g.lastPlayed; })
        .sort(function (a, b) { return new Date(b.lastPlayed) - new Date(a.lastPlayed); })
        .slice(0, 4);
    }

    if (!list.length) {
      var silent = el("div", "rcard");
      silent.appendChild(el("div", "rcard__name", "Тишина в эфире"));
      wrap.appendChild(silent);
      wrap.classList.add("is-single");
      return;
    }

    if (list.length === 1) wrap.classList.add("is-single");

    var rc = ["#E10600", "#FF5A4D", "#C0130A", "#8E8E93"];
    list.forEach(function (g, i) {
      var card = el("div", "rcard");
      card.style.setProperty("--rc", rc[i % rc.length]);

      if (g.appid) {
        var art = el("a", "rcard__art game-link");
        art.target = "_blank";
        art.rel = "noopener";
        art.href = "https://store.steampowered.com/app/" + encodeURIComponent(g.appid) + "/";
        var img = el("img", "rcard__img");
        img.src = "https://cdn.cloudflare.steamstatic.com/steam/apps/" + encodeURIComponent(g.appid) + "/header.jpg";
        img.alt = g.name || "";
        img.loading = "lazy";
        img.onerror = function () { art.style.display = "none"; };
        art.appendChild(img);
        card.appendChild(art);
      }

      var d = daysAgo(g.lastPlayed);
      var eyebrow = el("div", "eyebrow");
      if (i === 0) eyebrow.appendChild(el("span", "pulse"));
      eyebrow.appendChild(document.createTextNode(i === 0 ? "главное занятие" : "также в ротации"));
      card.appendChild(eyebrow);
      var rcardName = el("div", "rcard__name");
      rcardName.appendChild(gameLabel(g));
      card.appendChild(rcardName);
      var big = el("div", "rcard__big", smartDec(g.hours2w || 0));
      big.appendChild(el("span", "", "ч за 2 недели"));
      card.appendChild(big);
      var ago = d === null ? "" : (d === 0 ? "играл сегодня" : d + " " + plural(d, ["день", "дня", "дней"]) + " назад");
      card.appendChild(el("div", "rcard__meta", ago + " · всего " + smartDec(g.hours) + " ч"));
      wrap.appendChild(card);
    });
  })();

  /* ---------- 04 · донат по жанрам ---------- */

  (function donut() {
    var svg = $("#donut"), legend = $("#legend");
    svg.textContent = ""; legend.textContent = "";
    var sum = genreData.reduce(function (s, x) { return s + x.hours; }, 0);
    if (!sum) {
      $("#donutValue").textContent = "—";
      $("#donutLabel").textContent = "жанров";
      return;
    }

    var R = 78, C = 2 * Math.PI * R, off = 0;
    var palette = ["#E10600", "#FF5A4D", "#C0130A", "#EDEDEF", "#8E8E93",
                   "#6E6E73", "#48484E", "#3A3A3F"];

    /* Минимальная дуга. Симулятор и MMO — это 0,4% и 0,1%: их доля
       короче зазора между сегментами, дуга получалась отрицательной
       и жанр просто не рисовался. Даём каждому видимый минимум и
       забираем добавку у самых крупных, чтобы сумма осталась целой. */
    var GAP = 2, MINARC = 7;
    var arcs = genreData.map(function (g) { return g.hours / sum * C; });
    var debt = 0;
    arcs = arcs.map(function (a) {
      if (a < MINARC) { debt += MINARC - a; return MINARC; }
      return a;
    });
    if (debt > 0) {
      var big = arcs.reduce(function (s, a) { return s + (a > MINARC ? a : 0); }, 0);
      arcs = arcs.map(function (a) { return a > MINARC ? a - debt * (a / big) : a; });
    }

    var ns = "http://www.w3.org/2000/svg";
    genreData.forEach(function (g, i) {
      var frac = g.hours / sum;
      var arc = arcs[i];
      var c = document.createElementNS(ns, "circle");
      c.setAttribute("class", "donut__seg");
      c.setAttribute("cx", 100); c.setAttribute("cy", 100); c.setAttribute("r", R);
      c.setAttribute("fill", "none");
      c.setAttribute("stroke", palette[i % palette.length]);
      c.setAttribute("stroke-width", 22);
      c.setAttribute("stroke-dasharray", Math.max(arc - GAP, 1.5).toFixed(2) + " " + C);
      c.setAttribute("stroke-dashoffset", (-off).toFixed(2));
      c.dataset.i = i;
      svg.appendChild(c);

      off += arc;

      var row = el("div", "legend__row");
      row.dataset.i = i;
      row.style.setProperty("--lc", palette[i % palette.length]);
      var dot = el("span", "legend__dot"); dot.style.background = palette[i % palette.length];
      row.appendChild(dot);
      row.appendChild(el("span", "legend__name", g.name));
      row.appendChild(el("span", "legend__pct", pctStr(frac * 100) + "%"));
      row.appendChild(el("span", "legend__hours", num(g.hours) + " ч"));
      legend.appendChild(row);

      row.addEventListener("mouseenter", function () { highlight(i, g); });
      row.addEventListener("mouseleave", function () { highlight(null); });
      c.addEventListener("mouseenter", function () { highlight(i, g); });
      c.addEventListener("mouseleave", function () { highlight(null); });
      row.addEventListener("click", function () { highlight(i, g); });
      c.addEventListener("click", function () { highlight(i, g); });
    });

    var dv = $("#donutValue"), dl = $("#donutLabel");
    var defaultValue = String(genreData.length), defaultLabel = plural(genreData.length, ["жанр", "жанра", "жанров"]);
    dv.textContent = defaultValue; dl.textContent = defaultLabel;

    function pctStr(p) {
      return dec(p, p < 1 ? 1 : 0);
    }

    function highlight(i, g) {
      $$(".donut__seg", svg).forEach(function (s) { s.classList.remove("is-hover"); });
      $$(".legend__row", legend).forEach(function (r) { r.classList.remove("is-hover"); });
      if (i === null) {
        svg.classList.remove("has-hover");
        legend.classList.remove("has-hover");
        dv.textContent = defaultValue;
        dv.style.color = "";
        dl.textContent = defaultLabel;
        return;
      }
      svg.classList.add("has-hover");
      legend.classList.add("has-hover");
      var seg = svg.querySelector('.donut__seg[data-i="' + i + '"]');
      if (seg) seg.classList.add("is-hover");
      var lrow = legend.querySelector('.legend__row[data-i="' + i + '"]');
      if (lrow) lrow.classList.add("is-hover");
      dv.textContent = pctStr(g.hours / sum * 100) + "%";
      dv.style.color = palette[i % palette.length];
      dl.textContent = g.name;
    }
  })();

  /* ---------- 05 · судьба вечера ---------- */

  (function fate() {
    var stage = $("#fateStage"), btn = $("#fateBtn");
    // повторный boot: сцену возвращаем к заглушкам (исходный HTML — один раз),
    // кнопку включаем заново и возвращаем исходную подпись
    if (stage.dataset.base === undefined) stage.dataset.base = stage.innerHTML;
    else stage.innerHTML = stage.dataset.base;
    btn.disabled = !backlog.length;
    btn.textContent = "Бросить кости";

    if (!backlog.length) {
      if (neverPlayed > 0) {
        // цифра есть, списка нет: данные собирались вручную / выгрузка неполная
        $("#fateCount").textContent = "В бэклоге " + num(neverPlayed) + " " +
          plural(neverPlayed, ["игра", "игры", "игр"]) +
          ", но их имена подтянутся при ближайшем обновлении данных";
        function emptySlot(lines) {
          var slot = el("div", "fate__slot fate__slot--empty");
          lines.forEach(function (line, index) {
            if (index) slot.appendChild(document.createElement("br"));
            slot.appendChild(document.createTextNode(line));
          });
          return slot;
        }
        stage.textContent = "";
        stage.appendChild(emptySlot([num(neverPlayed) + " игр ждут", "своего часа"]));
        stage.appendChild(emptySlot(["список появится", "после обновления данных"]));
        stage.appendChild(emptySlot(["а пока —", "решай сам"]));
      } else {
        $("#fateCount").textContent = "Бэклог пуст — редкое достижение";
      }
      return;
    }

    $("#fateCount").textContent = "В бэклоге " + num(neverPlayed) + " " +
      plural(neverPlayed, ["игра", "игры", "игр"]) + ", ни одна не запущена";

    function pick3() {
      var pool = backlog.slice(), out = [];
      while (out.length < Math.min(3, backlog.length) && pool.length) {
        out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      }
      return out;
    }

    function render(list, rolling) {
      stage.textContent = "";
      list.forEach(function (g, i) {
        var slot = el("div", "fate__slot" + (rolling ? " is-rolling" : ""));
        if (g.appid) {
          var art = el("a", "fate__art game-link");
          art.target = "_blank";
          art.rel = "noopener";
          art.href = "https://store.steampowered.com/app/" + encodeURIComponent(g.appid) + "/";
          if (!rolling) {
            var img = el("img", "fate__img");
            img.src = "https://cdn.cloudflare.steamstatic.com/steam/apps/" + encodeURIComponent(g.appid) + "/header.jpg";
            img.alt = g.name || "";
            img.loading = "lazy";
            img.onerror = function () { art.style.display = "none"; };
            art.appendChild(img);
          }
          slot.appendChild(art);
        }
        slot.appendChild(el("div", "fate__idx", "ВАРИАНТ " + String(i + 1).padStart(2, "0")));
        var fateName = el("div", "fate__name");
        fateName.appendChild(gameLabel(g));
        slot.appendChild(fateName);
        slot.appendChild(el("div", "fate__tags", (g.genres || []).join(" · ") || "жанр неизвестен"));
        stage.appendChild(slot);
      });
    }

    // Сразу генерируем 3 игры с обложками при загрузке
    render(pick3(), false);
    btn.textContent = "Другие варианты 🎲";

    // onclick, а не addEventListener: повторный boot перезаписывает обработчик
    // вместо дублирования (иначе одна кнопка крутила бы рулетку дважды)
    btn.onclick = function () {
      btn.disabled = true;
      var ticks = 0;
      var spin = setInterval(function () {
        render(pick3(), true);
        if (++ticks > 8) {
          clearInterval(spin);
          render(pick3(), false);
          btn.disabled = false;
          btn.textContent = "Другие варианты 🎲";
          $$(".fate__slot", stage).forEach(function (slot) {
            slot.classList.add("is-landed");
            setTimeout(function () { slot.classList.remove("is-landed"); }, 380);
          });
        }
      }, 70);
    };
  })();

  /* ---------- 06 · карточка для шаринга ---------- */

  var shareCanvas = $("#shareCanvas");

  /* аватар для карточки. Файл лежит рядом, в assets/img — это тот же
     источник, что и на странице. Для живого профиля это внешний Steam-аватар:
     crossOrigin="anonymous" нужен, чтобы он не «taint»ил canvas — иначе
     toDataURL()/toBlob() бросают SecurityError и карточку нельзя ни скачать,
     ни скопировать. Если CDN не отдаст CORS, картинка просто не загрузится,
     нарисуется цветная плашка, но копирование останется рабочим. */
  var avatarImg = null;
  if (D.meta && D.meta.avatar) {
    avatarImg = new Image();
    avatarImg.crossOrigin = "anonymous";
    avatarImg.onload = function () { if (myBoot === bootSeq) redrawCard(); };
    avatarImg.onerror = function () { if (myBoot !== bootSeq) return; avatarImg = null; redrawCard(); };
    avatarImg.src = D.meta.avatar;
  }

  function redrawCard() {
    if (myBoot !== bootSeq) return;   // устаревший вызов после повторного boot
    var c = shareCanvas, x = c.getContext("2d");
    // возврат из широкой: вертикальный расчёт всегда идёт от 1080
    if (c.width !== 1080) { c.width = 1080; x = c.getContext("2d"); }
    var W = c.width, H = c.height;
    var INK = "#EDEDEF", NEAR = "#F7F7F8", DIM = "#A7A7AD", FAINT = "#6E6E75";
    var C1 = "#E10600", C2 = "#C0130A", C3 = "#8E0D08", C4 = "#FF5A4D", C5 = "#EDEDEF";
    var RED = cardTheme === "red";
    var css = getComputedStyle(document.documentElement);
    var SANS = (css.getPropertyValue("--display") || "").trim() || 'Arial, sans-serif';
    var WD = (css.getPropertyValue("--w-display") || "700").trim();
    var M = 88;

    /* Текстовый движок без обрезок: только автоподгон кегля и переносы.
       Старого fit() с «…» больше нет — ни одна строка не режется. */
    function fontOf(weight, size) { return weight + " " + size + "px " + SANS; }
    function textW(t, font) { x.font = font; return x.measureText(t).width; }
    function shrinkTo(t, maxW, weight, start, min) {
      var fs = start, f = fontOf(weight, fs);
      while (fs > min && textW(t, f) > maxW) { fs -= 2; f = fontOf(weight, fs); }
      return { size: fs, font: f };
    }
    // однострочники без переноса (цифры, подпись): жмёмся до пола 12px, лишь бы без «…»
    function shrinkSingle(t, maxW, weight, start, min) {
      var r = shrinkTo(t, maxW, weight, start, min);
      var fs = r.size, f = r.font;
      while (fs > 12 && textW(t, f) > maxW) { fs -= 2; f = fontOf(weight, fs); }
      return { size: fs, font: f };
    }
    function chunkWord(word, maxW, font) {
      var parts = [], cur = "", i, trial;
      for (i = 0; i < word.length; i++) {
        trial = cur + word.charAt(i);
        x.font = font;
        if (x.measureText(trial).width <= maxW || !cur) cur = trial;
        else { parts.push(cur); cur = word.charAt(i); }
      }
      if (cur) parts.push(cur);
      return parts.length ? parts : [word];
    }
    function wrapLines(t, maxW, font) {
      var words = String(t).split(/\s+/).filter(function (w) { return w; });
      var lines = [], cur = "";
      if (!words.length) return [""];
      words.forEach(function (word) {
        x.font = font;
        if (x.measureText(word).width > maxW) {
          if (cur) { lines.push(cur); cur = ""; }
          var chunks = chunkWord(word, maxW, font);
          for (var i = 0; i < chunks.length - 1; i++) lines.push(chunks[i]);
          cur = chunks[chunks.length - 1];
          return;
        }
        var trial = cur ? cur + " " + word : word;
        if (x.measureText(trial).width <= maxW) cur = trial;
        else { lines.push(cur); cur = word; }
      });
      if (cur) lines.push(cur);
      return lines;
    }
    function fitWrapped(t, maxW, weight, start, min, maxLines) {
      var fs = start, f = fontOf(weight, fs), lines = wrapLines(t, maxW, f);
      while (lines.length > maxLines && fs > min) {
        fs -= 2; f = fontOf(weight, fs); lines = wrapLines(t, maxW, f);
      }
      while (lines.length > maxLines && fs > 12) {
        fs -= 2; f = fontOf(weight, fs); lines = wrapLines(t, maxW, f);
      }
      return { size: fs, font: f, lines: lines };
    }
    // одна строка, если влезла читаемым кеглем, иначе перенос в две — без «…»
    function fitOneOrTwo(t, maxW, weight, singleStart, singleMin, wrapStart, wrapMin) {
      var s = shrinkTo(t, maxW, weight, singleStart, singleMin);
      if (textW(t, s.font) <= maxW) return { size: s.size, font: s.font, lines: [t] };
      return fitWrapped(t, maxW, weight, wrapStart, wrapMin, 2);
    }

    function line(y) {
      x.strokeStyle = RED ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.12)"; x.lineWidth = 1;
      x.beginPath(); x.moveTo(M, y + 0.5); x.lineTo(W - M, y + 0.5); x.stroke();
    }
    function label(t, y, color, xPos) {
      x.fillStyle = color || DIM; x.font = "700 22px " + SANS;
      if ("letterSpacing" in x) x.letterSpacing = "4px";
      x.fillText(t.toUpperCase(), xPos === undefined ? M : xPos, y);
      if ("letterSpacing" in x) x.letterSpacing = "0px";
    }
    function roundRect(px, py, pw, ph, rr) {
      x.beginPath();
      x.moveTo(px + rr, py);
      x.arcTo(px + pw, py, px + pw, py + ph, rr);
      x.arcTo(px + pw, py + ph, px, py + ph, rr);
      x.arcTo(px, py + ph, px, py, rr);
      x.arcTo(px, py, px + pw, py, rr);
      x.closePath();
    }

    /* Раскладка считается до первого пикселя: обычные данные дают те же
       координаты, что раньше (lineY=372 и т.д.), длинные сдвигают низ вниз,
       а холст при необходимости вытягивается выше 1350. */
    var persona = D.meta.persona || "profile";
    var nameX = M + 144 + 36, nameW = (W - M) - (M + 144 + 36);
    var nick = fitOneOrTwo(persona, nameW, WD, 80, 48, 56, 36);
    var nickLineH = Math.round(nick.size * 1.12);
    var nickFirstY, sloganY, lineY;
    if (nick.lines.length < 2) {
      nickFirstY = 246;
      sloganY = 302;
    } else {
      nickFirstY = 218;
      sloganY = nickFirstY + nickLineH * (nick.lines.length - 1) + 56;
    }
    lineY = sloganY + 70;

    var cols = [
      [num(gamesOwned), "игр", num(neverPlayed) + " в бэклоге"],
      [num(totalHours), "часов", "≈ " + dec(totalHours / 24, 0) + " " +
        plural(totalHours / 24, ["день", "дня", "дней"]) + " нон-стоп"],
      [num(hours2w), "за 2 недели", "≈ " + dec(hours2w / 14, 1) + " ч в день"]
    ];
    var colW = (W - M * 2) / 3;
    var valY = lineY + 128, labY = lineY + 176, ctxY = lineY + 214;

    var smUnit = (soulmate && dataLayer && dataLayer.soulmateUnit)
      ? dataLayer.soulmateUnit(soulmate, rules) : null;
    var hasShare = !!(soulmate && totalHours);
    var sm = null, smLineH = 0, smFirstY = 0, smDaysY = 0, smShareY = 0, smUnitY = 0;
    var py = 0, ph = 0, panelBottom = 0;
    if (soulmate) {
      py = lineY + 276;
      sm = fitOneOrTwo(soulmate.name, 440, WD, 44, 32, 40, 28);
      smLineH = Math.round(sm.size * 1.15);
      var smLastRel;
      if (sm.lines.length < 2) {
        smFirstY = py + 132;
        smLastRel = 132;
        smDaysY = py + 178;
      } else {
        smFirstY = py + 120;
        smLastRel = 120 + smLineH * (sm.lines.length - 1);
        smDaysY = py + smLastRel + 46;
      }
      smShareY = smDaysY + 40;
      smUnitY = hasShare ? smShareY + 36 : smDaysY + 76;
      var smLastY = smDaysY;
      if (hasShare) smLastY = smShareY;
      if (smUnit) smLastY = smUnitY;
      ph = smLastY - py + 42;
      if (ph < 296) ph = 296;
      panelBottom = py + ph;
    } else {
      panelBottom = lineY + 276;
    }

    var tcol = RED ? ["#FFFFFF", "#FFFFFF", "#FFFFFF"] : [C1, "#FF5A4D", C5];
    var topList = played.slice(0, 3);
    var topRows = [];
    var curY = panelBottom + 64, lastTopY = curY;
    topList.forEach(function (g, i) {
      var hoursText = num(g.hours) + " ч" +
        (totalHours ? " · " + dec(g.hours / totalHours * 100, 0) + "%" : "");
      var hoursFont = fontOf(WD, 26);
      var nameStartX = M + 64;
      var nameMaxW = (W - M - textW(hoursText, hoursFont) - 24) - nameStartX;
      if (nameMaxW < 200) nameMaxW = 200;
      var nm = fitOneOrTwo(g.name, nameMaxW, "700", 26, 20, 24, 18);
      var lh = Math.round(nm.size * 1.3);
      topRows.push({ g: g, i: i, hoursText: hoursText, hoursFont: hoursFont,
        name: nm, lineH: lh, y: curY });
      lastTopY = curY + lh * (nm.lines.length - 1);
      curY = lastTopY + 58;
    });

    var genreSum = genreData.reduce(function (s, g) { return s + g.hours; }, 0);
    var gTop = genreSum > 0 ? genreData.slice(0, 3) : [];
    var gCols = RED ? ["#FFFFFF", "#FFFFFF", "#FFFFFF"] : [C1, C4, "#C9C9CE"];
    var gParts = gTop.map(function (g) {
      return g.name + " " + dec(g.hours / genreSum * 100, 0) + "%";
    });
    var genreY = 0, genreSecondY = 0, genreLines = [], genreFont = "600 21px " + SANS;
    var contentBottom = panelBottom;
    if (gParts.length) {
      genreY = (topRows.length ? lastTopY + 68 : panelBottom + 64);
      var gMaxW = W - M * 2;
      var gFull = "Жанры: " + gParts.join(" · ");
      if (textW(gFull, genreFont) <= gMaxW) {
        genreLines = [{ prefix: "Жанры: ", parts: gParts }];
        contentBottom = genreY;
      } else {
        var gSmall = shrinkSingle(gFull, gMaxW, "600", 21, 18);
        if (textW(gFull, gSmall.font) <= gMaxW) {
          genreFont = gSmall.font;
          genreLines = [{ prefix: "Жанры: ", parts: gParts }];
          contentBottom = genreY;
        } else {
          genreFont = "600 21px " + SANS;
          var line1 = { prefix: "Жанры: ", parts: [] }, line2 = { prefix: "", parts: [] };
          var wCur = textW("Жанры: ", genreFont), first = true;
          var sepW = textW(" · ", genreFont);
          gParts.forEach(function (part) {
            var pw = textW(part, genreFont);
            var need = first ? pw : pw + sepW;
            if (first || wCur + need <= gMaxW) {
              line1.parts.push(part);
              wCur += need;
              first = false;
            } else {
              line2.parts.push(part);
            }
          });
          if (!line1.parts.length && line2.parts.length) {
            line1.parts = line2.parts; line2.parts = [];
          }
          genreLines = line2.parts.length ? [line1, line2] : [line1];
          genreSecondY = genreY + 30;
          contentBottom = line2.parts.length ? genreSecondY : genreY;
        }
      }
    } else if (topRows.length) {
      contentBottom = lastTopY;
    } else if (soulmate) {
      contentBottom = panelBottom;
    } else {
      contentBottom = ctxY;
    }

    /* Теснота вертикали: ник или игры упёрлись в пол кегля даже в две
       строки — уходим в широкую карточку, где тем же строкам просторно. */
    var pinched = nick.size < 36 || (sm && sm.size < 28) ||
      topRows.some(function (row) { return row.name.size < 18; });

    /* Широкая карточка 1600×N: те же данные и темы, просторные боксы.
       W мутирует наружу осознанно: line()/label() строят по новой ширине,
       после return вертикальный код не выполняется. */
    function drawWide() {
      W = 1600;
      // ник: бокс почти на всю ширину
      var wNameX = M + 64 + 64 + 32, wNameW = (W - M) - wNameX;
      var wNick = fitOneOrTwo(persona, wNameW, WD, 88, 52, 64, 40);
      var wNickLh = Math.round(wNick.size * 1.12);
      var wNickY, wSloganY;
      if (wNick.lines.length < 2) { wNickY = 248; wSloganY = 304; }
      else { wNickY = 212; wSloganY = wNickY + wNickLh * (wNick.lines.length - 1) + 54; }
      var wLineY = wSloganY + 66;
      // статы — компактная строка вместо трёх колонок
      var wColLab = RED ? ["#FFFFFF", "#FFFFFF", "#FFFFFF"] : [C1, C4, C5];
      var wDim = RED ? "rgba(255,255,255,0.7)" : DIM;
      var wStripY = wLineY + 58;
      var segs = [];
      cols.forEach(function (col, i) {
        if (i) segs.push({ t: "  ·  ", f: 20, w: "600", c: wDim });
        segs.push({ t: col[0], f: 30, w: "700", c: NEAR });
        segs.push({ t: " " + col[1], f: 22, w: "600", c: wColLab[i] });
        segs.push({ t: " (" + col[2] + ")", f: 20, w: "600", c: wDim });
      });
      function segW(k) {
        var s = 0;
        segs.forEach(function (g) { s += textW(g.t, fontOf(g.w, Math.max(12, Math.round(g.f * k)))); });
        return s;
      }
      var wBox = W - M * 2, k = 1;
      if (segW(1) > wBox) {
        // сначала выбрасываем контексты в скобках, потом жмём кегль
        segs = segs.filter(function (g) { return g.t.charAt(1) !== "("; });
        k = wBox / segW(1);
        if (k > 1) k = 1;
        if (k < 0.7) k = 0.7;
      }
      // панель игры жизни: имя получает бокс 1000 вместо 440
      var wPy = wStripY + 52, wPh = 0, wPanelBottom = 0;
      var wSm = null, wSmLh = 0, wSmFirstY = 0, wSmDaysY = 0, wSmShareY = 0, wSmUnitY = 0;
      if (soulmate) {
        wSm = fitOneOrTwo(soulmate.name, 1000, WD, 48, 34, 44, 30);
        wSmLh = Math.round(wSm.size * 1.15);
        var wLastRel;
        if (wSm.lines.length < 2) { wSmFirstY = wPy + 128; wLastRel = 128; wSmDaysY = wPy + 178; }
        else { wSmFirstY = wPy + 116; wLastRel = 116 + wSmLh * (wSm.lines.length - 1); wSmDaysY = wPy + wLastRel + 46; }
        wSmShareY = wSmDaysY + 38;
        wSmUnitY = hasShare ? wSmShareY + 34 : wSmDaysY + 72;
        var wSmLastY = wSmDaysY;
        if (hasShare) wSmLastY = wSmShareY;
        if (smUnit) wSmLastY = wSmUnitY;
        wPh = wSmLastY - wPy + 40;
        if (wPh < 280) wPh = 280;
        wPanelBottom = wPy + wPh;
      } else {
        wPanelBottom = wPy;
      }
      // топ-3: бокс названий ~1080 вместо ~586
      var wTopRows = [], wCurY = wPanelBottom + 58, wLastTopY = wCurY;
      topList.forEach(function (g, i) {
        var hoursText = num(g.hours) + " ч" +
          (totalHours ? " · " + dec(g.hours / totalHours * 100, 0) + "%" : "");
        var hoursFont = fontOf(WD, 26);
        var wNameMaxW = (W - M - textW(hoursText, hoursFont) - 24) - (M + 64);
        var nm = fitOneOrTwo(g.name, wNameMaxW, "700", 28, 22, 26, 20);
        var lh = Math.round(nm.size * 1.3);
        wTopRows.push({ g: g, i: i, hoursText: hoursText, hoursFont: hoursFont,
          name: nm, lineH: lh, y: wCurY });
        wLastTopY = wCurY + lh * (nm.lines.length - 1);
        wCurY = wLastTopY + 50;
      });
      // жанры — тот же алгоритм, якоря свои
      var wGenreY = 0, wGenreSecondY = 0, wGenreLines = [], wGenreFont = "600 21px " + SANS;
      var wContentBottom = wPanelBottom;
      if (gParts.length) {
        wGenreY = (wTopRows.length ? wLastTopY + 62 : wPanelBottom + 54);
        var wGMaxW = W - M * 2;
        var wGFull = "Жанры: " + gParts.join(" · ");
        if (textW(wGFull, wGenreFont) <= wGMaxW) {
          wGenreLines = [{ prefix: "Жанры: ", parts: gParts }];
          wContentBottom = wGenreY;
        } else {
          var wGSmall = shrinkSingle(wGFull, wGMaxW, "600", 21, 18);
          if (textW(wGFull, wGSmall.font) <= wGMaxW) {
            wGenreFont = wGSmall.font;
            wGenreLines = [{ prefix: "Жанры: ", parts: gParts }];
            wContentBottom = wGenreY;
          } else {
            wGenreFont = "600 21px " + SANS;
            var wL1 = { prefix: "Жанры: ", parts: [] }, wL2 = { prefix: "", parts: [] };
            var wCur = textW("Жанры: ", wGenreFont), wFirst = true;
            var wSepW = textW(" · ", wGenreFont);
            gParts.forEach(function (part) {
              var pw = textW(part, wGenreFont);
              var need = wFirst ? pw : pw + wSepW;
              if (wFirst || wCur + need <= wGMaxW) {
                wL1.parts.push(part); wCur += need; wFirst = false;
              } else {
                wL2.parts.push(part);
              }
            });
            if (!wL1.parts.length && wL2.parts.length) { wL1.parts = wL2.parts; wL2.parts = []; }
            wGenreLines = wL2.parts.length ? [wL1, wL2] : [wL1];
            wGenreSecondY = wGenreY + 30;
            wContentBottom = wL2.parts.length ? wGenreSecondY : wGenreY;
          }
        }
      } else if (wTopRows.length) {
        wContentBottom = wLastTopY;
      } else if (soulmate) {
        wContentBottom = wPanelBottom;
      } else {
        wContentBottom = wStripY;
      }
      var wFootLineY = wContentBottom + 50;
      var wNeedH = wFootLineY + 104;
      if (wNeedH < 900) wNeedH = 900;
      c.width = 1600; c.height = wNeedH; x = c.getContext("2d");
      H = wNeedH;
      var wFootY = H - 48;

      // фон — те же темы, пятна масштабируются от W/H
      if (!RED) {
        x.fillStyle = "#0A0807"; x.fillRect(0, 0, W, H);
      } else {
        var wBg = x.createLinearGradient(0, 0, W, H);
        wBg.addColorStop(0, "#F31200"); wBg.addColorStop(0.35, "#E10600");
        wBg.addColorStop(0.7, "#C0130A"); wBg.addColorStop(1, "#8E0D08");
        x.fillStyle = wBg; x.fillRect(0, 0, W, H);
      }
      (function paintWideBlobs() {
        function blob(cx, cy, r, color) {
          var g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
          x.fillStyle = g; x.fillRect(0, 0, W, H);
        }
        if (!RED) {
          blob(W * 0.5, H * 0.28, W * 0.80, "rgba(225,6,0,0.10)");
          blob(W * 0.10, H * 0.92, W * 0.70, "rgba(192,19,10,0.10)");
          blob(W * 0.92, H * 0.82, W * 0.65, "rgba(142,13,8,0.12)");
          blob(W * 0.15, H * 0.52, W * 0.50, "rgba(255,90,77,0.07)");
        } else {
          blob(W * 0.5, H * 1.05, W * 0.85, "rgba(142,13,8,0.45)");
          blob(W * 0.5, H * -0.08, W * 0.7, "rgba(255,255,255,0.10)");
        }
      })();

      // шапка
      label("STEAM WRAPPED", 92, C5);
      x.fillStyle = RED ? "#FFFFFF" : C4; x.font = "700 22px " + SANS;
      x.textAlign = "right"; x.fillText((D.meta.generatedAt || "").slice(0, 7), W - M, 92); x.textAlign = "left";
      line(120);

      // аватар
      var wAvCx = M + 64, wAvCy = 225, wAvR = 64;
      (function paintWideGlow() {
        function blob(cx, cy, r, color) {
          var g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
          x.fillStyle = g; x.fillRect(0, 0, W, H);
        }
        blob(wAvCx, wAvCy, 230, RED ? "rgba(142,13,8,0.35)" : "rgba(225,6,0,0.20)");
        blob(wAvCx, wAvCy, 140, RED ? "rgba(142,13,8,0.28)" : "rgba(192,19,10,0.16)");
      })();
      x.save();
      x.beginPath(); x.arc(wAvCx, wAvCy, wAvR, 0, Math.PI * 2); x.clip();
      if (avatarImg && avatarImg.complete && avatarImg.naturalWidth) {
        var ws = Math.max((wAvR * 2) / avatarImg.naturalWidth, (wAvR * 2) / avatarImg.naturalHeight);
        var wdw = avatarImg.naturalWidth * ws, wdh = avatarImg.naturalHeight * ws;
        x.drawImage(avatarImg, wAvCx - wdw / 2, wAvCy - wdh / 2, wdw, wdh);
      } else {
        var wag = x.createLinearGradient(wAvCx - wAvR, wAvCy - wAvR, wAvCx + wAvR, wAvCy + wAvR);
        wag.addColorStop(0, C1); wag.addColorStop(1, C4);
        x.fillStyle = wag; x.fillRect(wAvCx - wAvR, wAvCy - wAvR, wAvR * 2, wAvR * 2);
        x.fillStyle = "#FFFFFF"; x.font = "800 68px " + SANS;
        x.textAlign = "center"; x.textBaseline = "middle";
        x.fillText(persona.charAt(0).toUpperCase(), wAvCx, wAvCy + 6);
        x.textAlign = "left"; x.textBaseline = "alphabetic";
      }
      x.restore();
      var wRing = x.createLinearGradient(wAvCx - wAvR, wAvCy - wAvR, wAvCx + wAvR, wAvCy + wAvR);
      wRing.addColorStop(0, RED ? "#FFFFFF" : C1); wRing.addColorStop(0.55, RED ? "#FFFFFF" : C4); wRing.addColorStop(1, RED ? "#FFFFFF" : C2);
      x.strokeStyle = wRing; x.lineWidth = 7;
      x.beginPath(); x.arc(wAvCx, wAvCy, wAvR + 11, 0, Math.PI * 2); x.stroke();

      // ник + слоган
      x.fillStyle = NEAR; x.font = wNick.font;
      x.fillText(wNick.lines[0], wNameX, wNickY);
      for (var wni = 1; wni < wNick.lines.length; wni++) {
        x.fillText(wNick.lines[wni], wNameX, wNickY + wNickLh * wni);
      }
      var wTag = x.createLinearGradient(wNameX, 0, wNameX + 520, 0);
      wTag.addColorStop(0, RED ? "#FFFFFF" : C1); wTag.addColorStop(1, RED ? "#FFFFFF" : C4);
      x.fillStyle = wTag; x.font = fontOf(WD, 34);
      x.fillStyle = RED ? "rgba(255,255,255,0.85)" : C4;
      x.font = "700 20px " + SANS;
      if ("letterSpacing" in x) x.letterSpacing = "2px";
      x.fillText(arch.title.toUpperCase(), wNameX, wSloganY);
      if ("letterSpacing" in x) x.letterSpacing = "0px";
      line(wLineY);

      // строка статов
      var sX = M;
      segs.forEach(function (g) {
        var f = fontOf(g.w, Math.max(12, Math.round(g.f * k)));
        x.font = f; x.fillStyle = g.c;
        x.fillText(g.t, sX, wStripY);
        sX += textW(g.t, f);
      });

      // панель игры жизни
      if (soulmate) {
        var wPL = M, wPR = W - M, wRR = 30;
        x.save();
        roundRect(wPL, wPy, wPR - wPL, wPh, wRR); x.clip();
        x.fillStyle = RED ? "#FFFFFF" : "rgba(20, 20, 22, 0.92)";
        x.fillRect(wPL, wPy, wPR - wPL, wPh);
        var wHl = x.createLinearGradient(wPL, 0, wPR, 0);
        wHl.addColorStop(0, C1); wHl.addColorStop(1, C4);
        x.fillStyle = wHl; x.fillRect(wPL, wPy, wPR - wPL, 5);
        x.restore();
        x.strokeStyle = RED ? "rgba(142,13,8,0.18)" : "rgba(255,255,255,0.08)"; x.lineWidth = 1.5;
        roundRect(wPL + 0.75, wPy + 0.75, wPR - wPL - 1.5, wPh - 1.5, wRR); x.stroke();

        label("ГЛАВНАЯ ИГРА ЖИЗНИ", wPy + 52, RED ? C1 : C4, wPL + 40);
        var wNg = x.createLinearGradient(wPL + 40, 0, wPL + 560, 0);
        wNg.addColorStop(0, "#FFFFFF"); wNg.addColorStop(1, C5);
        x.fillStyle = RED ? "#141416" : wNg; x.font = wSm.font;
        x.fillText(wSm.lines[0], wPL + 40, wSmFirstY);
        for (var wsi = 1; wsi < wSm.lines.length; wsi++) {
          x.fillText(wSm.lines[wsi], wPL + 40, wSmFirstY + wSmLh * wsi);
        }
        var wDays = soulmate.hours / 24;
        var wDaysText = "≈ " + dec(wDays, wDays >= 100 ? 0 : 1) + " " +
          plural(Math.round(wDays), ["день", "дня", "дней"]) + " нон-стоп";
        var wDaysFit = shrinkSingle(wDaysText, 700, "600", 24, 16);
        x.fillStyle = RED ? "#3F3F46" : DIM; x.font = wDaysFit.font;
        x.fillText(wDaysText, wPL + 40, wSmDaysY);
        if (hasShare) {
          var wShareText = dec(soulmate.hours / totalHours * 100, 0) + "% всего времени";
          var wShareFit = shrinkSingle(wShareText, 700, "600", 23, 16);
          x.fillStyle = RED ? C1 : C4; x.font = wShareFit.font;
          x.fillText(wShareText, wPL + 40, wSmShareY);
        }
        if (smUnit) {
          var wUnitText = "≈ " + num(soulmate.hours * 60 / smUnit.min) + " " + smUnit.word;
          var wUnitFit = shrinkSingle(wUnitText, 700, "600", 23, 16);
          x.fillStyle = RED ? "#3F3F46" : DIM; x.font = wUnitFit.font;
          x.fillText(wUnitText, wPL + 40, wSmUnitY);
        }

        x.textAlign = "right";
        var wHs = shrinkSingle(num(soulmate.hours), 320, WD, 100, 40);
        x.fillStyle = RED ? C1 : "#FFFFFF"; x.font = wHs.font;
        x.fillText(num(soulmate.hours), wPR - 40, wPy + 132);
        x.fillStyle = RED ? "#3F3F46" : DIM; x.font = "600 24px " + SANS;
        x.fillText("часов", wPR - 40, wPy + 190);
        x.textAlign = "left";
      }

      // топ-3
      wTopRows.forEach(function (row) {
        x.fillStyle = tcol[row.i]; x.font = "700 22px " + SANS;
        x.fillText(String(row.i + 1).padStart(2, "0"), M, row.y);
        x.fillStyle = RED ? "#FFFFFF" : "#C9C9CE"; x.font = row.name.font;
        x.fillText(row.name.lines[0], M + 64, row.y);
        for (var li = 1; li < row.name.lines.length; li++) {
          x.fillText(row.name.lines[li], M + 64, row.y + row.lineH * li);
        }
        x.fillStyle = tcol[row.i]; x.font = row.hoursFont;
        x.textAlign = "right"; x.fillText(row.hoursText, W - M, row.y); x.textAlign = "left";
      });

      // жанры
      if (wGenreLines.length) {
        var wGMaxW2 = W - M * 2;
        wGenreLines.forEach(function (gl, gi) {
          var gy = gi ? wGenreSecondY : wGenreY;
          var totalStr = (gl.prefix || "") + gl.parts.join(" · ");
          var wLineFont = wGenreFont;
          if (textW(totalStr, wLineFont) > wGMaxW2) {
            wLineFont = shrinkSingle(totalStr, wGMaxW2, "600", 21, 12).font;
          }
          var gX = M;
          x.font = wLineFont;
          if (gl.prefix) {
            x.fillStyle = RED ? "rgba(255,255,255,0.7)" : DIM; x.fillText(gl.prefix, gX, gy);
            gX += textW(gl.prefix, wLineFont);
            x.font = wLineFont;
          }
          var partIndex = gi ? wGenreLines[0].parts.length : 0;
          gl.parts.forEach(function (part, pi) {
            if (pi) {
              x.fillStyle = RED ? "rgba(255,255,255,0.7)" : DIM; x.font = wLineFont; x.fillText(" · ", gX, gy);
              gX += textW(" · ", wLineFont);
            }
            x.fillStyle = gCols[(partIndex + pi) % gCols.length];
            x.font = wLineFont;
            x.fillText(part, gX, gy);
            gX += textW(part, wLineFont);
          });
        });
      }

      // подвал
      line(wFootLineY);
      var wFootUrl = "kyuuketsukiakado.github.io/steam-wrapped";
      var wFootFit = shrinkSingle(wFootUrl, 680, "600", 18, 14);
      x.fillStyle = RED ? "#FFFFFF" : C4; x.font = wFootFit.font;
      x.fillText(wFootUrl, M, wFootY);
      if (D.meta.memberSince) {
        x.textAlign = "right";
        x.fillStyle = RED ? "rgba(255,255,255,0.7)" : DIM; x.font = "600 18px " + SANS;
        x.fillText("в Steam с " + String(D.meta.memberSince).slice(0, 4), W - M, wFootY);
        x.textAlign = "left";
      }
    }

    if (pinched) { drawWide(); return; }

    /* Холст вытягивается под длинные данные, обычные остаются 1080×1350.
       Низ (линейка + подпись) всегда на фиксированных отступах от контента. */
    var footLineY = contentBottom + 52;
    var needH = footLineY + 106;
    if (needH < 1350) needH = 1350;
    if (c.height !== needH) {
      c.height = needH;
      x = c.getContext("2d");
    }
    H = c.height;
    W = c.width;
    var footY = H - 50;

    /* ---------- рисуем ---------- */
    if (!RED) {
      x.fillStyle = "#0A0807"; x.fillRect(0, 0, W, H);
    } else {
      var cardBg = x.createLinearGradient(0, 0, W, H);
      cardBg.addColorStop(0, "#F31200"); cardBg.addColorStop(0.35, "#E10600");
      cardBg.addColorStop(0.7, "#C0130A"); cardBg.addColorStop(1, "#8E0D08");
      x.fillStyle = cardBg; x.fillRect(0, 0, W, H);
    }
    (function paintBlobs() {
      function blob(cx, cy, r, color) {
        var g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
        x.fillStyle = g; x.fillRect(0, 0, W, H);
      }
      if (!RED) {
        blob(W * 0.5, H * 0.28, W * 0.80, "rgba(225,6,0,0.10)");
        blob(W * 0.10, H * 0.92, W * 0.70, "rgba(192,19,10,0.10)");
        blob(W * 0.92, H * 0.82, W * 0.65, "rgba(142,13,8,0.12)");
        blob(W * 0.15, H * 0.52, W * 0.50, "rgba(255,90,77,0.07)");
      } else {
        blob(W * 0.5, H * 1.05, W * 0.85, "rgba(142,13,8,0.45)");
        blob(W * 0.5, H * -0.08, W * 0.7, "rgba(255,255,255,0.10)");
      }
    })();

    // шапка
    label("STEAM WRAPPED", 92, C5);
    x.fillStyle = RED ? "#FFFFFF" : C4; x.font = "700 22px " + SANS;
    x.textAlign = "right"; x.fillText((D.meta.generatedAt || "").slice(0, 7), W - M, 92); x.textAlign = "left";
    line(120);

    // аватар: круг с градиентным кольцом, как в wrapped-постере. Пока
    // картинка не загрузилась — градиентная плашка с первой буквой ника.
    var avCx = M + 72, avCy = 234, avR = 72;
    (function paintAvatarGlow() {
      function blob(cx, cy, r, color) {
        var g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
        x.fillStyle = g; x.fillRect(0, 0, W, H);
      }
      blob(avCx, avCy, 250, RED ? "rgba(142,13,8,0.35)" : "rgba(225,6,0,0.20)");
      blob(avCx, avCy, 150, RED ? "rgba(142,13,8,0.28)" : "rgba(192,19,10,0.16)");
    })();
    x.save();
    x.beginPath(); x.arc(avCx, avCy, avR, 0, Math.PI * 2); x.clip();
    if (avatarImg && avatarImg.complete && avatarImg.naturalWidth) {
      // вписываем по короткой стороне, без искажения пропорций
      var s = Math.max((avR * 2) / avatarImg.naturalWidth, (avR * 2) / avatarImg.naturalHeight);
      var dw = avatarImg.naturalWidth * s, dh = avatarImg.naturalHeight * s;
      x.drawImage(avatarImg, avCx - dw / 2, avCy - dh / 2, dw, dh);
    } else {
      var ag = x.createLinearGradient(avCx - avR, avCy - avR, avCx + avR, avCy + avR);
      ag.addColorStop(0, C1); ag.addColorStop(1, C4);
      x.fillStyle = ag; x.fillRect(avCx - avR, avCy - avR, avR * 2, avR * 2);
      x.fillStyle = "#FFFFFF"; x.font = "800 76px " + SANS;
      x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(persona.charAt(0).toUpperCase(), avCx, avCy + 6);
      x.textAlign = "left"; x.textBaseline = "alphabetic";
    }
    x.restore();
    var ring = x.createLinearGradient(avCx - avR, avCy - avR, avCx + avR, avCy + avR);
    ring.addColorStop(0, RED ? "#FFFFFF" : C1); ring.addColorStop(0.55, RED ? "#FFFFFF" : C4); ring.addColorStop(1, RED ? "#FFFFFF" : C2);
    x.strokeStyle = ring; x.lineWidth = 7;
    x.beginPath(); x.arc(avCx, avCy, avR + 11, 0, Math.PI * 2); x.stroke();

    // ник (до двух строк) + слоган; линейка едет за слоганом
    x.fillStyle = NEAR; x.font = nick.font;
    x.fillText(nick.lines[0], nameX, nickFirstY);
    for (var ni = 1; ni < nick.lines.length; ni++) {
      x.fillText(nick.lines[ni], nameX, nickFirstY + nickLineH * ni);
    }
    var tag = x.createLinearGradient(nameX, 0, nameX + 520, 0);
    tag.addColorStop(0, RED ? "#FFFFFF" : C1); tag.addColorStop(1, RED ? "#FFFFFF" : C4);
    x.fillStyle = tag; x.font = fontOf(WD, 36);
    x.fillStyle = RED ? "rgba(255,255,255,0.85)" : C4;
    x.font = "700 20px " + SANS;
    if ("letterSpacing" in x) x.letterSpacing = "2px";
    x.fillText(arch.title.toUpperCase(), nameX, sloganY);
    if ("letterSpacing" in x) x.letterSpacing = "0px";
    line(lineY);

    // три числа-колосса: значение, подпись и строка контекста под ней
    var colLab = RED ? ["#FFFFFF", "#FFFFFF", "#FFFFFF"] : [C1, C4, C5];
    cols.forEach(function (col, i) {
      var cx = M + colW * i + colW / 2;
      var vs = shrinkSingle(col[0], colW - 8, WD, 80, 40);
      x.textAlign = "center";
      x.fillStyle = NEAR; x.font = vs.font;
      x.fillText(col[0], cx, valY);
      x.fillStyle = colLab[i]; x.font = "600 26px " + SANS;
      x.fillText(col[1], cx, labY);
      var sub = shrinkSingle(col[2], colW - 16, "600", 20, 14);
      x.fillStyle = RED ? "rgba(255,255,255,0.82)" : DIM; x.font = sub.font;
      x.fillText(col[2], cx, ctxY);
      x.textAlign = "left";
    });

    // игра жизни — плашка тянется под двустрочное название
    if (soulmate) {
      var pL = M, pR = W - M, rr = 30;
      x.save();
      roundRect(pL, py, pR - pL, ph, rr); x.clip();
      x.fillStyle = RED ? "#FFFFFF" : "rgba(20, 20, 22, 0.92)"; x.fillRect(pL, py, pR - pL, ph);
      var hl = x.createLinearGradient(pL, 0, pR, 0);
      hl.addColorStop(0, C1); hl.addColorStop(1, C4);
      x.fillStyle = hl; x.fillRect(pL, py, pR - pL, 5);
      x.restore();
      x.strokeStyle = RED ? "rgba(142,13,8,0.18)" : "rgba(255,255,255,0.08)"; x.lineWidth = 1.5;
      roundRect(pL + 0.75, py + 0.75, pR - pL - 1.5, ph - 1.5, rr); x.stroke();

      label("ГЛАВНАЯ ИГРА ЖИЗНИ", py + 56, RED ? C1 : C4, pL + 40);
      var ng = x.createLinearGradient(pL + 40, 0, pL + 500, 0);
      ng.addColorStop(0, "#FFFFFF"); ng.addColorStop(1, C5);
      x.fillStyle = RED ? "#141416" : ng; x.font = sm.font;
      x.fillText(sm.lines[0], pL + 40, smFirstY);
      for (var si = 1; si < sm.lines.length; si++) {
        x.fillText(sm.lines[si], pL + 40, smFirstY + smLineH * si);
      }
      var days = soulmate.hours / 24;
      var daysText = "≈ " + dec(days, days >= 100 ? 0 : 1) + " " +
        plural(Math.round(days), ["день", "дня", "дней"]) + " нон-стоп";
      var daysFit = shrinkSingle(daysText, 440, "600", 24, 16);
      x.fillStyle = RED ? "#3F3F46" : DIM; x.font = daysFit.font;
      x.fillText(daysText, pL + 40, smDaysY);
      if (hasShare) {
        var shareText = dec(soulmate.hours / totalHours * 100, 0) + "% всего времени";
        var shareFit = shrinkSingle(shareText, 440, "600", 23, 16);
        x.fillStyle = RED ? C1 : C4; x.font = shareFit.font;
        x.fillText(shareText, pL + 40, smShareY);
      }
      if (smUnit) {
        var unitText = "≈ " + num(soulmate.hours * 60 / smUnit.min) + " " + smUnit.word;
        var unitFit = shrinkSingle(unitText, 440, "600", 23, 16);
        x.fillStyle = RED ? "#3F3F46" : DIM; x.font = unitFit.font;
        x.fillText(unitText, pL + 40, smUnitY);
      }

      x.textAlign = "right";
      var hs = shrinkSingle(num(soulmate.hours), 380, WD, 100, 40);
      x.fillStyle = RED ? C1 : "#FFFFFF"; x.font = hs.font;
      x.fillText(num(soulmate.hours), pR - 40, py + 136);
      x.fillStyle = RED ? "#3F3F46" : DIM; x.font = "600 24px " + SANS;
      x.fillText("часов", pR - 40, py + 196);
      x.textAlign = "left";
    }

    // топ-3: ширина названия отмеряется от часов справа, длинные — в две строки
    topRows.forEach(function (row) {
      x.fillStyle = tcol[row.i]; x.font = "700 22px " + SANS;
      x.fillText(String(row.i + 1).padStart(2, "0"), M, row.y);
      x.fillStyle = RED ? "#FFFFFF" : "#C9C9CE"; x.font = row.name.font;
      x.fillText(row.name.lines[0], M + 64, row.y);
      for (var li = 1; li < row.name.lines.length; li++) {
        x.fillText(row.name.lines[li], M + 64, row.y + row.lineH * li);
      }
      x.fillStyle = tcol[row.i]; x.font = row.hoursFont;
      x.textAlign = "right"; x.fillText(row.hoursText, W - M, row.y); x.textAlign = "left";
    });

    // жанры: одна строка, при переполнении — две; обрезок нет
    if (genreLines.length) {
      var gMaxW2 = W - M * 2;
      genreLines.forEach(function (gl, gi) {
        var gy = gi ? genreSecondY : genreY;
        var totalStr = (gl.prefix || "") + gl.parts.join(" · ");
        var lineFont = genreFont;
        if (textW(totalStr, lineFont) > gMaxW2) {
          lineFont = shrinkSingle(totalStr, gMaxW2, "600", 21, 12).font;
        }
        var gX = M;
        x.font = lineFont;
        if (gl.prefix) {
          x.fillStyle = RED ? "rgba(255,255,255,0.7)" : DIM; x.fillText(gl.prefix, gX, gy);
          gX += textW(gl.prefix, lineFont);
          x.font = lineFont;
        }
        var partIndex = gi ? genreLines[0].parts.length : 0;
        gl.parts.forEach(function (part, pi) {
          if (pi) {
            x.fillStyle = RED ? "rgba(255,255,255,0.7)" : DIM; x.font = lineFont; x.fillText(" · ", gX, gy);
            gX += textW(" · ", lineFont);
          }
          x.fillStyle = gCols[(partIndex + pi) % gCols.length];
          x.font = lineFont;
          x.fillText(part, gX, gy);
          gX += textW(part, lineFont);
        });
      });
    }

    line(footLineY);
    var footUrl = "kyuuketsukiakado.github.io/steam-wrapped";
    var footFit = shrinkSingle(footUrl, 680, "600", 18, 14);
    x.fillStyle = RED ? "#FFFFFF" : C4; x.font = footFit.font;
    x.fillText(footUrl, M, footY);
    if (D.meta.memberSince) {
      x.textAlign = "right";
      x.fillStyle = RED ? "rgba(255,255,255,0.7)" : DIM; x.font = "600 18px " + SANS;
      x.fillText("в Steam с " + String(D.meta.memberSince).slice(0, 4), W - M, footY);
      x.textAlign = "left";
    }
  }
  redrawCardLive = redrawCard;
  redrawCard();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawCard);

  /* ---------- скачать / скопировать ---------- */

  var toast = $("#toast"), toastT;
  function say(msg) {
    toast.textContent = msg;
    toast.classList.add("is-on");
    clearTimeout(toastT);
    toastT = setTimeout(function () { toast.classList.remove("is-on"); }, 2400);
  }

  function downloadCard() {
    var a = document.createElement("a");
    a.download = "steam-wrapped-" + (D.meta.persona || "profile") + ".png";
    a.href = shareCanvas.toDataURL("image/png");
    a.click();
    say("Карточка скачана ✓");
  }

  // Все кнопки ниже — через onclick: повторный boot перезаписывает обработчик,
  // addEventListener плодил бы дубли (двойные скачивания, окна шаринга).
  $("#dlBtn").onclick = downloadCard;

  function copyCard() {
    // Промис: карточка в буфер обмена. Соцсети не умеют принимать файл
    // по ссылке, поэтому единственный честный путь — буфер + Ctrl+V.
    if (!navigator.clipboard || !window.ClipboardItem) return Promise.reject();
    return new Promise(function (resolve, reject) {
      shareCanvas.toBlob(function (blob) {
        if (!blob) { reject(); return; }
        navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
          .then(resolve, reject);
      });
    });
  }

  $("#copyBtn").onclick = function () {
    copyCard().then(
      function () { say("Скопировано в буфер ✓"); },
      function () { say("Не вышло скопировать — скачай PNG"); }
    );
  };

  /* ---------- поделиться в соцсети ---------- */

  var PAGE_URL = (document.querySelector('meta[property="og:url"]') || {}).content ||
                 location.href.split("#")[0];

  function defaultCaption() {
    var t = D.totals || {};
    var days = totalHours ? dec(totalHours / 24, 0) : "0";
    var parts = [];
    parts.push(num(totalHours) + " " + plural(totalHours, ["час", "часа", "часов"]) + " в Steam.");
    parts.push("Это " + days + " " + plural(+days, ["день", "дня", "дней"]) + " подряд без сна.");
    if (soulmate) {
      parts.push("Игра жизни — " + soulmate.name + " (" + num(soulmate.hours) + " ч).");
    }
    parts.push(num(t.gamesOwned || gamesOwned) + " " +
               plural(t.gamesOwned || gamesOwned, ["игра", "игры", "игр"]) + " в библиотеке, " +
               num(t.gamesNeverPlayed || 0) + " так и не запущены.");
    return parts.join(" ");
  }

  var capBox = $("#captionBox");
  if (capBox) capBox.value = defaultCaption();

  function caption() {
    return (capBox && capBox.value.trim()) || defaultCaption();
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () { say("Текст скопирован ✓"); },
        function () { say("Не вышло скопировать текст"); }
      );
    }
    say("Браузер не умеет копировать текст");
    return Promise.reject();
  }

  function openShare(url) {
    // noopener обязателен: без него открытая вкладка получает доступ к нашей
    window.open(url, "_blank", "noopener,noreferrer");
  }

  /* Окно публикации открываем синхронно в жесте клика: window.open после
     await/таймера попадает под попап-блокировщик, из-за чего «пост не
     создавался». Карточку в буфер кладём следом — подскажем вставить Ctrl+V. */
  function shareVia(build, name) {
    var text = caption();
    openShare(build(text));
    copyCard().then(
      function () { say("Карточка в буфере — вставь в " + name + " через Ctrl+V"); },
      function () { say("Карточку скопировать не вышло, скачай PNG"); }
    );
  }

  var tg = $("#tgBtn"), li = $("#liBtn"), dc = $("#dcBtn");

  if (tg) tg.onclick = function () {
    shareVia(function (text) {
      return "https://t.me/share/url?url=" + encodeURIComponent(PAGE_URL) +
             "&text=" + encodeURIComponent(text);
    }, "Telegram");
  };

  if (li) li.onclick = function () {
    // LinkedIn берёт из ссылки только URL, текст подставляем через буфер
    shareVia(function () {
      return "https://www.linkedin.com/sharing/share-offsite/?url=" + encodeURIComponent(PAGE_URL);
    }, "LinkedIn");
  };

  if (dc) dc.onclick = function () {
    // у Discord нет окна публикации: кладём в буфер подпись и ссылку,
    // а карточку отдаём скачиванием — PNG прикрепляешь к сообщению вручную.
    copyText(caption() + "\n" + PAGE_URL);
    downloadCard();
  };

  var capCopy = $("#capCopyBtn"), capReset = $("#capResetBtn");
  if (capCopy) capCopy.onclick = function () {
    copyText(caption() + "\n" + PAGE_URL);
  };
  if (capReset) capReset.onclick = function () {
    capBox.value = defaultCaption();
    say("Подпись возвращена");
  };


  }

  // Статичная карточка не вызывает Worker сама. Живой запрос возможен только
  // после отправки формы или при явном ?profile= в адресе.
  var WORKER_ORIGIN = "https://steam-wrapped-api.repro4chful.workers.dev";
  var PAGES_ORIGIN = "https://kyuuketsukiakado.github.io";
  var MAX_LIVE_GENRE_APPIDS = 8;

  function profileQuery() {
    try { return new URL(window.location.href).searchParams.get("profile") || ""; }
    catch (_) { return ""; }
  }

  function setProfileStatus(message, state) {
    var node = document.getElementById("profileStatus");
    if (!node) return;
    node.textContent = message;
    node.className = "profile-form__status" + (state ? " is-" + state : "");
  }

  function resetProfileUrl() {
    var url = new URL(window.location.href);
    url.searchParams.delete("profile");
    return url.href;
  }

  function wireProfileForm(dataLayer, rules) {
    var form = document.getElementById("profileForm");
    var input = document.getElementById("profileInput");
    var reset = document.getElementById("profileReset");
    var requested = profileQuery();
    if (!form || !input) return;

    if (requested) {
      input.value = requested;
      if (reset) {
        reset.hidden = false;
        reset.href = resetProfileUrl();
      }
    }

    // Чипы-примеры: вставляют заготовку в поле и ставят фокус.
    // Логику сабмита не трогают — дальше работает штатная валидация.
    Array.prototype.forEach.call(form.querySelectorAll("[data-fill]"), function (chip) {
      chip.addEventListener("click", function () {
        input.value = chip.getAttribute("data-fill");
        input.focus();
      });
    });

    input.addEventListener("input", function () { input.removeAttribute("aria-invalid"); });

    // Состояние загрузки: кнопка гаснет (.btn[disabled] уже в CSS) и честно
    // говорит «Загружаю…», поле блокируется от правок на время запроса.
    var submitBtn = form.querySelector('button[type="submit"]');
    var submitLabel = submitBtn ? submitBtn.textContent : "";
    function setFormBusy(busy) {
      if (submitBtn) {
        submitBtn.disabled = !!busy;
        submitBtn.textContent = busy ? "Загружаю…" : submitLabel;
      }
      input.disabled = !!busy;
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var value = input.value.trim();
      if (!dataLayer.validateProfileInput(value)) {
        setProfileStatus("Введи SteamID64, ник или обычную ссылку на профиль Steam.", "error");
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      // CORS сознательно ограничен опубликованным GitHub Pages (см. start):
      // на preview подгрузка недоступна — сообщаем сразу, без перезагрузки.
      if (window.location.origin !== PAGES_ORIGIN) {
        setProfileStatus("Живой профиль доступен на опубликованной GitHub Pages-странице.", "error");
        return;
      }
      setProfileStatus("Получаю публичные данные Steam…", "loading");
      setFormBusy(true);
      loadLiveProfile(value, rules, dataLayer).then(function (result) {
        announceLiveResult(result);
        // адрес обновляем без перезагрузки: страницу с ?profile= можно шарить,
        // а прямой заход по ней сразу строит живой профиль (см. start).
        var url = new URL(window.location.href);
        url.searchParams.set("profile", value);
        window.history.replaceState(null, "", url.href);
        if (reset) {
          reset.hidden = false;
          reset.href = resetProfileUrl();
        }
        try { boot(rules, result.data, false); }
        finally { setFormBusy(false); }
      }, function (error) {
        setProfileStatus(workerErrorMessage(error && error.code), "error");
        setFormBusy(false);
      });
    });
  }

  function workerErrorMessage(code) {
    var messages = {
      invalid_profile_input: "Не удалось распознать SteamID, ник или ссылку на профиль.",
      profile_not_found: "Steam не нашёл этот публичный профиль.",
      profile_games_unavailable: "Steam не отдал библиотеку. Проверь, что список игр открыт для просмотра.",
      rate_limit_reached: "Слишком много запросов. Попробуй немного позже.",
      daily_limit_reached: "Дневной лимит запросов уже исчерпан. Попробуй завтра.",
      upstream_unavailable: "Steam временно не отвечает. Попробуй немного позже.",
      api_disabled: "Живое обновление временно отключено."
    };
    return messages[code] || "Сервис временно недоступен. Попробуй немного позже.";
  }

  // Один статус успеха на первичную загрузку и на сабмит без reload.
  function announceLiveResult(result) {
    setProfileStatus(
      result.genreWarning
        ? "Профиль построен. Часть жанров временно недоступна."
        : "Профиль построен из публичных данных Steam.",
      result.genreWarning ? "" : "ok"
    );
  }

  function workerJson(path, options) {
    return fetch(WORKER_ORIGIN + path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          var err = new Error((data.error && data.error.code) || "service_unavailable");
          err.code = (data.error && data.error.code) || "service_unavailable";
          throw err;
        }
        return data;
      });
    }).catch(function (error) {
      // Ошибки сети/CORS не пробрасываем в DOM или логи с техническими деталями.
      if (error && error.code) throw error;
      var err = new Error("network_unavailable");
      err.code = "network_unavailable";
      throw err;
    });
  }

  function loadSeedGenres() {
    return fetch("assets/data/genres.json", { credentials: "same-origin" })
      .then(function (response) { return response.ok ? response.json() : {}; })
      .then(function (genres) {
        return genres && typeof genres === "object" && !Array.isArray(genres) ? genres : {};
      })
      .catch(function () { return {}; });
  }

  function rawOwnedGames(raw) {
    var owned = raw && raw.owned && raw.owned.response;
    return owned && Array.isArray(owned.games) ? owned.games : [];
  }

  function missingGenreAppids(raw, seedGenres) {
    return rawOwnedGames(raw)
      .filter(function (game) {
        var id = String(game && game.appid || "");
        return /^[1-9]\d{0,9}$/.test(id) && Number(game.playtime_forever || 0) > 0 && !seedGenres[id];
      })
      .sort(function (a, b) { return Number(b.playtime_forever || 0) - Number(a.playtime_forever || 0); })
      .slice(0, MAX_LIVE_GENRE_APPIDS)
      .map(function (game) { return Number(game.appid); });
  }

  function loadLiveProfile(profile, rules, dataLayer) {
    var encodedProfile = encodeURIComponent(profile);
    return Promise.all([
      workerJson("/v1/profile?profile=" + encodedProfile),
      loadSeedGenres()
    ]).then(function (result) {
      var raw = result[0];
      var seedGenres = result[1];
      var appids = missingGenreAppids(raw, seedGenres);
      if (!appids.length) return { raw: raw, seedGenres: seedGenres, genreWarning: false };

      // Ровно один ограниченный запрос жанров: максимум восемь наиболее
      // значимых неизвестных игр. Worker принимает только фиксированный маршрут.
      return workerJson("/v1/genres", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appids: appids })
      }).then(function (genres) {
        raw.genreHints = genres && genres.genres && typeof genres.genres === "object" ? genres.genres : {};
        return { raw: raw, seedGenres: seedGenres, genreWarning: false };
      }).catch(function () {
        // Профиль остаётся полезен даже при кратком сбое SteamSpy: доступны
        // накопленные жанры из статичного словаря, а расчёты не перемещаются в Worker.
        return { raw: raw, seedGenres: seedGenres, genreWarning: true };
      });
    }).then(function (payload) {
      return {
        data: dataLayer.normalizeSteamData(payload.raw, rules, payload.seedGenres),
        genreWarning: payload.genreWarning
      };
    });
  }

  /* ---------- против друга ---------- */

  var vnf = new Intl.NumberFormat("ru-RU");
  function vnum(n) { return vnf.format(Math.round(n)); }
  function vpct(n) { return (Math.round(n * 10) / 10).toString().replace(".", ",") + "%"; }
  function vEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* Метрики любого ProfileViewData — те же деривации, что в boot. */
  function versusMetrics(pvd) {
    var games = ((pvd && pvd.games) || []).slice().sort(function (a, b) { return b.hours - a.hours; });
    var played = games.filter(function (g) { return g.hours > 0; });
    var totals = (pvd && pvd.totals) || {};
    var totalHours = totals.hoursTotal != null ? totals.hoursTotal
      : played.reduce(function (s, g) { return s + g.hours; }, 0);
    var hours2w = totals.hoursTwoWeeks != null ? totals.hoursTwoWeeks
      : games.reduce(function (s, g) { return s + (g.hours2w || 0); }, 0);
    var gamesOwned = totals.gamesOwned != null ? totals.gamesOwned : games.length;
    var backlog = games.filter(function (g) { return !g.hours; });
    var neverPlayed = totals.gamesNeverPlayed != null ? totals.gamesNeverPlayed : backlog.length;
    var soulmate = (pvd && pvd.soulmateAppid &&
      games.filter(function (g) { return g.appid === pvd.soulmateAppid; })[0]) || played[0] || null;
    var gh = (pvd && pvd.genreHours && pvd.genreHours.length) ? pvd.genreHours.slice()
      : (function () {
          var map = {};
          played.forEach(function (g) {
            var gs = (g.genres && g.genres.length) ? g.genres : ["Без жанра"];
            gs.forEach(function (name) { map[name] = (map[name] || 0) + g.hours / gs.length; });
          });
          return Object.keys(map).map(function (k) { return { name: k, hours: map[k] }; })
            .sort(function (a, b) { return b.hours - a.hours; });
        })();
    var gsum = gh.reduce(function (s, x) { return s + x.hours; }, 0);
    return {
      nick: (pvd && pvd.meta && pvd.meta.persona) || "профиль",
      totalHours: totalHours, hours2w: hours2w, gamesOwned: gamesOwned,
      backlogPct: gamesOwned ? neverPlayed / gamesOwned * 100 : 0,
      soulmateHours: soulmate ? soulmate.hours : 0,
      soulmateName: soulmate ? soulmate.name : "—",
      genreShare: gsum && gh.length ? gh[0].hours / gsum * 100 : 0,
      genreName: gh.length ? gh[0].name : "—"
    };
  }

  var VROWS = [
    { label: "Часов всего", key: "totalHours", fmt: vnum },
    { label: "Игр в библиотеке", key: "gamesOwned", fmt: vnum },
    { label: "Бэклог", key: "backlogPct", fmt: vpct, low: true },
    { label: "Часов за 2 недели", key: "hours2w", fmt: vnum },
    { label: "Часы чемпиона", key: "soulmateHours", fmt: vnum, sub: "soulmateName" },
    { label: "Доля топ-жанра", key: "genreShare", fmt: vpct, sub: "genreName" }
  ];

  function renderVersus(a, b) {
    var table = document.getElementById("versusTable");
    var verdict = document.getElementById("versusVerdict");
    var status = document.getElementById("versusStatus");
    if (!table || !verdict) return;
    table.textContent = "";
    var head = vEl("tr");
    head.appendChild(vEl("th", "", ""));
    var tha = vEl("th", "nick", a.nick); tha.scope = "col";
    var thb = vEl("th", "nick", b.nick); thb.scope = "col";
    head.appendChild(tha); head.appendChild(thb);
    var thead = vEl("thead"); thead.appendChild(head); table.appendChild(thead);
    var body = vEl("tbody"), sa = 0, sb = 0;
    VROWS.forEach(function (row) {
      var va = a[row.key], vb = b[row.key];
      var winner = va === vb ? 0 : ((row.low ? va < vb : va > vb) ? 1 : 2);
      if (winner === 1) sa++; else if (winner === 2) sb++;
      var tr = vEl("tr");
      var label = vEl("th", "", row.label); label.scope = "row";
      tr.appendChild(label);
      [[va, winner === 1, a], [vb, winner === 2, b]].forEach(function (cell) {
        var td = vEl("td", cell[1] ? "is-winner" : "");
        td.appendChild(vEl("div", "vs-main", row.fmt(cell[0])));
        if (row.sub) td.appendChild(vEl("div", "vs-sub", cell[2][row.sub]));
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    table.hidden = false;
    verdict.textContent = "";
    if (sa === sb) {
      verdict.appendChild(document.createTextNode("Ничья " + sa + ":" + sb + " — равные соперники."));
    } else {
      verdict.appendChild(document.createTextNode("Счёт " + sa + ":" + sb + " — впереди "));
      verdict.appendChild(vEl("b", "", sa > sb ? a.nick : b.nick));
    }
    verdict.hidden = false;
    if (status) { status.textContent = ""; status.className = "versus-status"; }
  }

  function resetVersus() {
    var table = document.getElementById("versusTable");
    var verdict = document.getElementById("versusVerdict");
    var status = document.getElementById("versusStatus");
    if (table) { table.textContent = ""; table.hidden = true; }
    if (verdict) { verdict.textContent = ""; verdict.hidden = true; }
    if (status) {
      status.textContent = "Твоя сторона — данные, показанные на странице.";
      status.className = "versus-status";
    }
  }

  function wireVersus(dataLayer, rules) {
    var form = document.getElementById("versusForm");
    var input = document.getElementById("versusInput");
    if (!form || !input) return;
    function setStatus(msg, state) {
      var node = document.getElementById("versusStatus");
      if (!node) return;
      node.textContent = msg;
      node.className = "versus-status" + (state ? " is-" + state : "");
    }
    var btn = form.querySelector('button[type="submit"]');
    var btnLabel = btn ? btn.textContent : "";
    function setBusy(busy) {
      if (btn) { btn.disabled = !!busy; btn.textContent = busy ? "Загружаю…" : btnLabel; }
      input.disabled = !!busy;
    }
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var value = input.value.trim();
      if (!dataLayer || !dataLayer.validateProfileInput(value)) {
        setStatus("Введи SteamID64, ник или обычную ссылку на профиль Steam.", "error");
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      if (window.location.origin !== PAGES_ORIGIN) {
        setStatus("Сравнение доступно на опубликованной GitHub Pages-странице.", "error");
        return;
      }
      if (!currentPVD) {
        setStatus("Данные страницы ещё не готовы.", "error");
        return;
      }
      setStatus("Получаю публичные данные Steam…", "loading");
      setBusy(true);
      loadLiveProfile(value, rules, dataLayer).then(function (result) {
        try { renderVersus(versusMetrics(currentPVD), versusMetrics(result.data)); }
        finally { setBusy(false); }
      }, function (error) {
        setStatus(workerErrorMessage(error && error.code), "error");
        setBusy(false);
      });
    });
    input.addEventListener("input", function () { input.removeAttribute("aria-invalid"); });
  }

  /* Демо для preview (fetch там закрыт CORS): демо против демо — все ничьи.
     Вызвать из консоли: __versusDemo() */
  window.__versusDemo = function () {
    if (!currentPVD) return "нет данных";
    renderVersus(versusMetrics(currentPVD), versusMetrics(currentPVD));
    return "ok";
  };

  function start(rules, dataLayer) {
    wireProfileForm(dataLayer, rules);
    wireVersus(dataLayer, rules);
    var staticData = dataLayer.normalizeStaticData(window.STEAM_DATA, rules);
    var requested = profileQuery();
    if (!requested) {
      boot(rules, staticData, true);
      return;
    }
    if (!dataLayer.validateProfileInput(requested)) {
      setProfileStatus("Не удалось распознать SteamID, ник или ссылку на профиль.", "error");
      boot(rules, staticData, true);
      return;
    }
    // CORS сознательно ограничен опубликованным GitHub Pages. Preview Arena
    // показывает интерфейс, но не должен становиться дополнительным origin API.
    if (window.location.origin !== PAGES_ORIGIN) {
      setProfileStatus("Живой профиль доступен на опубликованной GitHub Pages-странице.", "error");
      boot(rules, staticData, true);
      return;
    }

    setProfileStatus("Получаю публичные данные Steam…", "loading");
    loadLiveProfile(requested, rules, dataLayer).then(function (result) {
      announceLiveResult(result);
      boot(rules, result.data, false);
    }).catch(function (error) {
      setProfileStatus(workerErrorMessage(error && error.code), "error");
      boot(rules, staticData, true);
    });
  }

  // rules.json — обычный статичный файл GitHub Pages, не запрос к Worker.
  // Если страницу открыли прямо как file:// и браузер запретил fetch, рендерим
  // исходную статичную карточку: профиль доступен, только тематический факт
  // будет нейтральным.
  var dataLayer = window.SteamWrappedData;
  if (!dataLayer) {
    console.warn("Не загрузился общий слой данных; использую data.js напрямую");
    boot(null, null, true);
    return;
  }
  var layerScript = Array.prototype.slice.call(document.querySelectorAll("script[src]"))
    .filter(function (script) { return /(?:^|\/)profile-data\.js(?:\?|$)/.test(script.src); })[0];
  // Берём URL от подключённого profile-data.js, а не от адреса страницы:
  // старые u/<steamid>/ карточки лежат глубже и тоже найдут общий rules.json.
  var rulesUrl = layerScript && layerScript.src
    ? new URL("../data/rules.json", layerScript.src).href
    : "assets/data/rules.json";
  dataLayer.loadRules(rulesUrl).then(function (rules) {
    start(rules, dataLayer);
  }).catch(function (error) {
    console.warn("rules.json не загрузился; включён нейтральный режим", error);
    boot(null, null, true);
  });

  /* ---------- хром страницы: прогресс, подсветка меню, кнопка наверх ----------
     Данных не касается: чистый UI-слушатель поверх готовой страницы. */
  (function chrome() {
    var bar = document.getElementById("scrollProgress");
    var top = document.getElementById("toTop");
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var max = document.documentElement.scrollHeight - window.innerHeight;
        var ratio = max > 0 ? Math.min(1, window.scrollY / max) : 0;
        if (bar) bar.style.transform = "scaleX(" + ratio + ")";
        if (top) top.classList.toggle("is-on", window.scrollY > 700);
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    if (top) top.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // Бургер: открыть/закрыть, закрыть по ссылке, Esc и при ресайзе в десктоп.
    var burger = document.getElementById("burger");
    var mnav = document.getElementById("mobileNav");
    function setNav(open) {
      if (!burger || !mnav) return;
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      mnav.classList.toggle("is-open", open);
    }
    if (burger && mnav) {
      burger.addEventListener("click", function () {
        setNav(burger.getAttribute("aria-expanded") !== "true");
      });
      mnav.addEventListener("click", function (e) {
        if (e.target && e.target.closest("a")) setNav(false);
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") setNav(false);
      });
      if (window.matchMedia) {
        var mq = window.matchMedia("(min-width: 781px)");
        var mqClose = function () { if (mq.matches) setNav(false); };
        if (mq.addEventListener) mq.addEventListener("change", mqClose);
        else if (mq.addListener) mq.addListener(mqClose);
      }
    }

    // Спотлайт в hero: свечение следует за курсором. Только без reduced-motion.
    var hero = document.getElementById("hero");
    if (hero && window.matchMedia && window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
      var hraf = null;
      hero.addEventListener("pointermove", function (e) {
        if (hraf) return;
        var cx = e.clientX, cy = e.clientY;
        hraf = requestAnimationFrame(function () {
          hraf = null;
          var r = hero.getBoundingClientRect();
          if (r.width && r.height) {
            hero.style.setProperty("--mx", ((cx - r.left) / r.width * 100).toFixed(1) + "%");
            hero.style.setProperty("--my", ((cy - r.top) / r.height * 100).toFixed(1) + "%");
          }
        });
      }, { passive: true });
    }

    var links = Array.prototype.slice.call(document.querySelectorAll('.topbar__nav a[href^="#"]'));
    if ("IntersectionObserver" in window && links.length) {
      var map = {};
      links.forEach(function (a) { map[a.getAttribute("href").slice(1)] = a; });
      var spy = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          var a = map[e.target.id];
          if (!a) return;
          if (e.isIntersecting) {
            links.forEach(function (l) { l.classList.remove("is-on"); });
            a.classList.add("is-on");
          }
        });
      }, { rootMargin: "-40% 0px -55% 0px" });
      Object.keys(map).forEach(function (id) {
        var sec = document.getElementById(id);
        if (sec) spy.observe(sec);
      });
    }
  })();
})();
