/* =========================================================
   STEAM WRAPPED — вся логика страницы.
   Данные приходят из assets/js/data.js (window.STEAM_DATA).
   ========================================================= */
(function () {
  "use strict";

  // Страница рисуется из одного ProfileViewData: сейчас это статичный data.js,
  // позже сюда же придёт нормализованный ответ Worker для профиля друга.
  function boot(rules, profileViewData, isDemoProfile) {
    var dataLayer = window.SteamWrappedData;
    var D = profileViewData || window.STEAM_DATA;
    if (!D) { console.error("Нет данных: assets/js/data.js не загрузился"); return; }
    // Для исходного data.js сохраняем прежний путь нормализации. Данные,
    // полученные Worker, уже нормализованы через normalizeSteamData() до boot.
    if (dataLayer && !profileViewData) D = dataLayer.normalizeStaticData(D, rules);

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

  /* ---------- шапка ---------- */

  var profileName = D.meta.persona || "steam profile";
  document.title = "Steam Wrapped · " + (isDemoProfile ? "пример: " : "") + profileName;
  $("#year").textContent = new Date().getFullYear();
  $("#heroNick").textContent = profileName;
  $("#heroEyebrow").textContent = (isDemoProfile ? "Демо-профиль" : "Профиль Steam") +
    (D.meta.memberSince ? " · в Steam с " + fmtDate(D.meta.memberSince) : "") +
    " · данные от " + fmtDate(D.meta.generatedAt);

  var pl = $("#profileLink");
  if (D.meta.profileUrl) pl.href = D.meta.profileUrl; else pl.style.display = "none";

  var av = $("#avatar");
  if (D.meta.avatar) {
    var img = new Image();
    img.src = D.meta.avatar;
    img.alt = D.meta.persona || "avatar";
    img.onload = function () { av.textContent = ""; av.appendChild(img); };
    img.onerror = function () { av.textContent = (D.meta.persona || "?").charAt(0).toUpperCase(); };
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

  if (soulmate) {
    var h = soulmate.hours;

    // Правила лежат в общем rules.json: для своего и чужого профиля
    // пересчёт выбирается одинаково — AppID → название → жанр → fallback.
    var unit = dataLayer && dataLayer.soulmateUnit
      ? dataLayer.soulmateUnit(soulmate, rules)
      : { min: 120, word: "вечеров", note: "по два часа, от «на часик» до «ещё один»" };

    $("#smName").textContent = soulmate.name;
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
    if (!top.length) return;
    var max = top[0].hours;
    var wrap = $("#bars");
    var ramp = ["#26D0FF", "#5B8CFF", "#00E0C6", "#8A7BFF", "#6FD8FF",
                "#4F9FFF", "#A06BFF", "#79E6D8", "#C0E8FF", "#A78BFF"];

    // два колосса почти вровень (Dota и CS2) — каждому свой акцент,
    // чтобы второе место не выглядело безнадёжным
    var colossi = top.length > 1 && top[1].hours / top[0].hours >= 0.8;

    // хвост десятки — холодный спектр без циана и индиго колоссов
    var tail = ["#4F9FFF", "#00E0C6", "#5B8CFF", "#6FD8FF",
                "#A06BFF", "#79E6D8", "#A78BFF", "#C0E8FF"];
    var colors = top.map(function (g, i) {
      if (colossi && i === 0) return "#26D0FF";   // электрик-циан — лидер
      if (colossi && i === 1) return "#8A7BFF";   // индиго — второй колосс
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
      body.appendChild(el("div", "bar__name", g.name));
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

    var rc = ["#5EF0DC", "#8FE8FF", "#9CC8FF", "#B6ACFF"];
    list.forEach(function (g, i) {
      var card = el("div", "rcard");
      card.style.setProperty("--rc", rc[i % rc.length]);
      var d = daysAgo(g.lastPlayed);
      var eyebrow = el("div", "eyebrow");
      if (i === 0) eyebrow.appendChild(el("span", "pulse"));
      eyebrow.appendChild(document.createTextNode(i === 0 ? "главное занятие" : "также в ротации"));
      card.appendChild(eyebrow);
      card.appendChild(el("div", "rcard__name", g.name));
      var big = el("div", "rcard__big", smartDec(g.hours2w || 0));
      big.appendChild(el("span", "", "ч за 2 недели"));
      card.appendChild(big);
      var ago = d === null ? "" : (d === 0 ? "играл сегодня" : d + " " + plural(d, ["день", "дня", "дней"]) + " назад");
      card.appendChild(el("div", "rcard__meta", ago + " · всего " + smartDec(g.hours) + " ч"));
      wrap.appendChild(card);
    });
  })();

  /* ---------- 04 · донат по жанрам ---------- */

  var genreData = (function () {
    // если данные пришли с готовой разбивкой по жанрам (fetch_data.py) —
    // верим ей: она посчитана по всей библиотеке, а не по выгрузке топа
    if (D.genreHours && D.genreHours.length) {
      return D.genreHours.slice();
    }
    var map = {};
    played.forEach(function (g) {
      var gs = (g.genres && g.genres.length) ? g.genres : ["Без жанра"];
      // часы делим поровну между жанрами игры, чтобы не раздувать сумму
      gs.forEach(function (name) {
        map[name] = (map[name] || 0) + g.hours / gs.length;
      });
    });
    var arr = Object.keys(map).map(function (k) { return { name: k, hours: map[k] }; })
                              .sort(function (a, b) { return b.hours - a.hours; });
    // всё, что мельче, схлопываем в «Прочее»
    if (arr.length > 6) {
      var rest = arr.slice(6).reduce(function (s, x) { return s + x.hours; }, 0);
      arr = arr.slice(0, 6);
      if (rest > 0) arr.push({ name: "Прочее", hours: rest });
    }
    return arr;
  })();

  (function donut() {
    var svg = $("#donut"), legend = $("#legend");
    var sum = genreData.reduce(function (s, x) { return s + x.hours; }, 0);
    if (!sum) return;

    var R = 78, C = 2 * Math.PI * R, off = 0;
    var palette = ["#26D0FF", "#8A7BFF", "#00E0C6", "#4F9FFF", "#6FD8FF",
                   "#5B8CFF", "#79E6D8", "#A78BFF", "#5E6B7E"];

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
        dv.textContent = defaultValue; dl.textContent = defaultLabel;
        return;
      }
      svg.classList.add("has-hover");
      svg.querySelector('.donut__seg[data-i="' + i + '"]').classList.add("is-hover");
      var lrow = legend.querySelector('.legend__row[data-i="' + i + '"]');
      if (lrow) lrow.classList.add("is-hover");
      dv.textContent = pctStr(g.hours / sum * 100) + "%";
      dl.textContent = g.name;
    }
  })();

  /* ---------- 05 · судьба вечера ---------- */

  (function fate() {
    var stage = $("#fateStage"), btn = $("#fateBtn");

    if (!backlog.length) {
      btn.disabled = true;
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
        slot.appendChild(el("div", "fate__idx", "ВАРИАНТ " + String(i + 1).padStart(2, "0")));
        slot.appendChild(el("div", "fate__name", g.name));
        slot.appendChild(el("div", "fate__tags", (g.genres || []).join(" · ") || "жанр неизвестен"));
        if (g.appid) {
          var link = el("a", "fate__link", "страница в Steam ↗");
          link.target = "_blank";
          link.rel = "noopener";
          link.href = "https://store.steampowered.com/app/" + encodeURIComponent(g.appid) + "/";
          slot.appendChild(link);
        }
        stage.appendChild(slot);
      });
    }

    btn.addEventListener("click", function () {
      btn.disabled = true;
      var ticks = 0;
      var spin = setInterval(function () {
        render(pick3(), true);
        if (++ticks > 9) {
          clearInterval(spin);
          render(pick3(), false);
          btn.disabled = false;
          btn.textContent = "Ещё раз 🎲";
        }
      }, 70);
    });
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
    avatarImg.onload = function () { redrawCard(); };
    avatarImg.onerror = function () { avatarImg = null; redrawCard(); };
    avatarImg.src = D.meta.avatar;
  }

  function redrawCard() {
    var c = shareCanvas, x = c.getContext("2d");
    var W = c.width, H = c.height;
    var INK = "#EAF1FA", NEAR = "#F7FBFF", DIM = "#8B94A6", FAINT = "#68758C";
    var C1 = "#26D0FF", C2 = "#8A7BFF", C3 = "#00E0C6", C4 = "#4F9FFF", C5 = "#C0E8FF";
    var css = getComputedStyle(document.documentElement);
    var SANS = (css.getPropertyValue("--display") || "").trim() || 'Arial, sans-serif';
    var WD = (css.getPropertyValue("--w-display") || "700").trim();

    // фон + цветные пятна
    x.fillStyle = "#070B13"; x.fillRect(0, 0, W, H);
    function blob(cx, cy, r, color) {
      var g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    }
    blob(W * 0.5, H * 0.28, W * 0.80, "rgba(38,208,255,0.17)");
    blob(W * 0.10, H * 0.92, W * 0.70, "rgba(79,159,255,0.16)");
    blob(W * 0.92, H * 0.82, W * 0.65, "rgba(138,123,255,0.18)");
    blob(W * 0.15, H * 0.52, W * 0.50, "rgba(0,224,198,0.10)");

    var M = 88;

    function line(y) {
      x.strokeStyle = "rgba(255,255,255,0.12)"; x.lineWidth = 1;
      x.beginPath(); x.moveTo(M, y + 0.5); x.lineTo(W - M, y + 0.5); x.stroke();
    }
    function label(t, y, color, xPos) {
      x.fillStyle = color || DIM; x.font = "700 22px " + SANS;
      if ("letterSpacing" in x) x.letterSpacing = "4px";
      x.fillText(t.toUpperCase(), xPos === undefined ? M : xPos, y);
      if ("letterSpacing" in x) x.letterSpacing = "0px";
    }
    function fit(t, maxW, font) {
      x.font = font;
      var s2 = t;
      while (x.measureText(s2).width > maxW && s2.length > 4) s2 = s2.slice(0, -2);
      return s2 === t ? t : s2 + "…";
    }
    function fitSize(t, maxW, size) {
      var fs = size;
      x.font = WD + " " + fs + "px " + SANS;
      while (x.measureText(t).width > maxW && fs > 40) {
        fs -= 4;
        x.font = WD + " " + fs + "px " + SANS;
      }
      return fs;
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

    // шапка
    label("STEAM WRAPPED", 92, C5);
    x.fillStyle = C4; x.font = "700 22px " + SANS;
    x.textAlign = "right"; x.fillText((D.meta.generatedAt || "").slice(0, 7), W - M, 92); x.textAlign = "left";
    line(120);

    // аватар: круг с градиентным кольцом, как в wrapped-постере. Пока
    // картинка не загрузилась — градиентная плашка с первой буквой ника.
    var persona = D.meta.persona || "profile";
    var avCx = M + 72, avCy = 234, avR = 72;
    blob(avCx, avCy, 250, "rgba(38,208,255,0.24)");
    blob(avCx, avCy, 150, "rgba(138,123,255,0.20)");
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
      x.fillStyle = "#070B13"; x.font = "800 76px " + SANS;
      x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(persona.charAt(0).toUpperCase(), avCx, avCy + 6);
      x.textAlign = "left"; x.textBaseline = "alphabetic";
    }
    x.restore();
    var ring = x.createLinearGradient(avCx - avR, avCy - avR, avCx + avR, avCy + avR);
    ring.addColorStop(0, C1); ring.addColorStop(0.55, C4); ring.addColorStop(1, C2);
    x.strokeStyle = ring; x.lineWidth = 7;
    x.beginPath(); x.arc(avCx, avCy, avR + 11, 0, Math.PI * 2); x.stroke();

    // строка профиля: аватар слева, ник и слоган справа. Горизонталь
    // отдаёт низу ~190px воздуха, а ник остаётся крупным.
    var nameX = M + 144 + 36, nameW = (W - M) - (M + 144 + 36);
    x.fillStyle = NEAR; x.font = WD + " 80px " + SANS;
    x.fillText(fit(persona, nameW, WD + " 80px " + SANS), nameX, 246);
    var tag = x.createLinearGradient(nameX, 0, nameX + 520, 0);
    tag.addColorStop(0, C1); tag.addColorStop(0.5, C4); tag.addColorStop(1, C2);
    x.fillStyle = tag; x.font = WD + " 36px " + SANS;
    x.fillText(fit("steam-профиль в цифрах", nameW, WD + " 36px " + SANS), nameX, 302);
    line(372);

    // три числа-колосса: значение, подпись и строка контекста под ней.
    // Цветных маркеров над числами нет: цифры сами держат композицию.
    var cols = [
      [num(gamesOwned), "игр", num(neverPlayed) + " в бэклоге"],
      [num(totalHours), "часов", "≈ " + dec(totalHours / 24, 0) + " " +
        plural(totalHours / 24, ["день", "дня", "дней"]) + " нон-стоп"],
      [num(hours2w), "за 2 недели", "≈ " + dec(hours2w / 14, 1) + " ч в день"]
    ];
    var colW = (W - M * 2) / 3;
    var colLab = [C1, C4, C3];
    cols.forEach(function (col, i) {
      var cx = M + colW * i + colW / 2;
      var vs = fitSize(col[0], colW - 8, 80);
      x.textAlign = "center";
      x.fillStyle = NEAR; x.font = WD + " " + vs + "px " + SANS;
      x.fillText(col[0], cx, 500);
      x.fillStyle = colLab[i]; x.font = "600 26px " + SANS;
      x.fillText(col[1], cx, 548);
      x.fillStyle = FAINT; x.font = "600 20px " + SANS;
      x.fillText(fit(col[2], colW - 16, "600 20px " + SANS), cx, 586);
      x.textAlign = "left";
    });

    // игра жизни — плашка с градиентной полосой сверху
    if (soulmate) {
      var py = 648, ph = 296, rr = 30;
      var pL = M, pR = W - M;
      x.save();
      roundRect(pL, py, pR - pL, ph, rr); x.clip();
      x.fillStyle = "rgba(13, 22, 38, 0.92)"; x.fillRect(pL, py, pR - pL, ph);
      var hl = x.createLinearGradient(pL, 0, pR, 0);
      hl.addColorStop(0, C1); hl.addColorStop(1, C4);
      x.fillStyle = hl; x.fillRect(pL, py, pR - pL, 5);
      x.restore();
      x.strokeStyle = "rgba(255,255,255,0.08)"; x.lineWidth = 1.5;
      roundRect(pL + 0.75, py + 0.75, pR - pL - 1.5, ph - 1.5, rr); x.stroke();

      label("ГЛАВНАЯ ИГРА ЖИЗНИ", py + 56, C1, pL + 40);
      var ng = x.createLinearGradient(pL + 40, 0, pL + 500, 0);
      ng.addColorStop(0, "#FFFFFF"); ng.addColorStop(1, C5);
      x.fillStyle = ng; x.font = WD + " 44px " + SANS;
      x.fillText(fit(soulmate.name, 440, WD + " 44px " + SANS), pL + 40, py + 132);
      var days = soulmate.hours / 24;
      x.fillStyle = DIM; x.font = "600 24px " + SANS;
      x.fillText("≈ " + dec(days, days >= 100 ? 0 : 1) + " " +
        plural(Math.round(days), ["день", "дня", "дней"]) + " нон-стоп", pL + 40, py + 178);
      // Каждая цифра — своей строкой: доля и единица из soulmateUnit
      // гарантированно влезают, обрезков вида «4498 …» больше нет.
      if (totalHours) {
        x.fillStyle = C3; x.font = "600 23px " + SANS;
        x.fillText(dec(soulmate.hours / totalHours * 100, 0) + "% всего времени", pL + 40, py + 218);
      }
      var smUnit = dataLayer && dataLayer.soulmateUnit
        ? dataLayer.soulmateUnit(soulmate, rules) : null;
      if (smUnit) {
        x.fillStyle = FAINT; x.font = "600 23px " + SANS;
        x.fillText("≈ " + num(soulmate.hours * 60 / smUnit.min) + " " + smUnit.word, pL + 40, py + 254);
      }

      x.textAlign = "right";
      var hg = x.createLinearGradient(pR - 420, 0, pR - 40, 0);
      hg.addColorStop(0, "#FFFFFF"); hg.addColorStop(1, "#AEE4FF");
      var hs = fitSize(num(soulmate.hours), 380, 100);
      x.fillStyle = hg; x.font = WD + " " + hs + "px " + SANS;
      x.fillText(num(soulmate.hours), pR - 40, py + 136);
      x.fillStyle = DIM; x.font = "600 24px " + SANS;
      x.fillText("часов", pR - 40, py + 196);
      x.textAlign = "left";
    }

    // топ-3 по часам: часы и доля от всего времени, много воздуха
    var tcol = [C1, "#9CC8FF", C3];
    played.slice(0, 3).forEach(function (g, i) {
      var ry = 1008 + i * 58;
      x.fillStyle = tcol[i]; x.font = "700 22px " + SANS;
      x.fillText(String(i + 1).padStart(2, "0"), M, ry);
      x.fillStyle = "#C6D2E2"; x.font = "700 26px " + SANS;
      x.fillText(fit(g.name, 520, "700 26px " + SANS), M + 64, ry);
      var hourShare = totalHours ? " · " + dec(g.hours / totalHours * 100, 0) + "%" : "";
      x.fillStyle = tcol[i]; x.font = WD + " 26px " + SANS;
      x.textAlign = "right"; x.fillText(num(g.hours) + " ч" + hourShare, W - M, ry); x.textAlign = "left";
    });

    // жанры — одна строка, каждый жанр своим цветом; если живому профилю
    // с длинными названиями не хватило ширины — однострочный фолбэк
    var genreSum = genreData.reduce(function (s, g) { return s + g.hours; }, 0);
    if (genreSum > 0) {
      var gTop = genreData.slice(0, 3);
      var gCols = [C1, C2, C3];
      var gParts = gTop.map(function (g) {
        return g.name + " " + dec(g.hours / genreSum * 100, 0) + "%";
      });
      x.font = "600 21px " + SANS;
      var gFull = "Жанры: " + gParts.join(" · ");
      if (x.measureText(gFull).width <= W - M * 2) {
        var gX = M;
        x.fillStyle = FAINT; x.fillText("Жанры: ", gX, 1192);
        gX += x.measureText("Жанры: ").width;
        gParts.forEach(function (part, i) {
          if (i) {
            x.fillStyle = FAINT; x.fillText(" · ", gX, 1192);
            gX += x.measureText(" · ").width;
          }
          x.fillStyle = gCols[i % gCols.length]; x.fillText(part, gX, 1192);
          gX += x.measureText(part).width;
        });
      } else {
        x.fillStyle = DIM;
        x.fillText(fit(gFull, W - M * 2, "600 21px " + SANS), M, 1192);
      }
    }

    // подпись: линия отбивки далеко и от жанров, и от самой подписи —
    // иначе низ выглядит слипшимся.
    line(1244);
    x.fillStyle = C4; x.font = "600 18px " + SANS;
    x.fillText(fit("kyuuketsukiakado.github.io/steam-wrapped", 680, "600 18px " + SANS), M, H - 50);
    if (D.meta.memberSince) {
      x.textAlign = "right";
      x.fillStyle = DIM; x.font = "600 18px " + SANS;
      x.fillText("в Steam с " + String(D.meta.memberSince).slice(0, 4), W - M, H - 50);
      x.textAlign = "left";
    }
  }
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

  $("#dlBtn").addEventListener("click", downloadCard);

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

  $("#copyBtn").addEventListener("click", function () {
    copyCard().then(
      function () { say("Скопировано в буфер ✓"); },
      function () { say("Не вышло скопировать — скачай PNG"); }
    );
  });

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

  if (tg) tg.addEventListener("click", function () {
    shareVia(function (text) {
      return "https://t.me/share/url?url=" + encodeURIComponent(PAGE_URL) +
             "&text=" + encodeURIComponent(text);
    }, "Telegram");
  });

  if (li) li.addEventListener("click", function () {
    // LinkedIn берёт из ссылки только URL, текст подставляем через буфер
    shareVia(function () {
      return "https://www.linkedin.com/sharing/share-offsite/?url=" + encodeURIComponent(PAGE_URL);
    }, "LinkedIn");
  });

  if (dc) dc.addEventListener("click", function () {
    // у Discord нет окна публикации: кладём в буфер подпись и ссылку,
    // а карточку отдаём скачиванием — PNG прикрепляешь к сообщению вручную.
    copyText(caption() + "\n" + PAGE_URL);
    downloadCard();
  });

  var capCopy = $("#capCopyBtn"), capReset = $("#capResetBtn");
  if (capCopy) capCopy.addEventListener("click", function () {
    copyText(caption() + "\n" + PAGE_URL);
  });
  if (capReset) capReset.addEventListener("click", function () {
    capBox.value = defaultCaption();
    say("Подпись возвращена");
  });

  /* ---------- появление секций ---------- */

  var revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("is-in"); revealObserver.unobserve(e.target); }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });

  $$(".reveal").forEach(function (n) { revealObserver.observe(n); });
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

  function wireProfileForm(dataLayer) {
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

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var value = input.value.trim();
      if (!dataLayer.validateProfileInput(value)) {
        setProfileStatus("Введи SteamID64, ник или обычную ссылку на профиль Steam.", "error");
        input.focus();
        return;
      }
      var url = new URL(window.location.href);
      url.searchParams.set("profile", value);
      window.location.assign(url.href);
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

  function start(rules, dataLayer) {
    wireProfileForm(dataLayer);
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
      setProfileStatus(
        result.genreWarning
          ? "Профиль построен. Часть жанров временно недоступна."
          : "Профиль построен из публичных данных Steam.",
        result.genreWarning ? "" : "ok"
      );
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
})();
