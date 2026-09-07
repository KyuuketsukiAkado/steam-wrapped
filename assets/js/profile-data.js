/* =========================================================
   STEAM WRAPPED — общий слой данных.

   Рендерер страницы получает единый ProfileViewData независимо
   от источника:
     • normalizeStaticData() — статичный data.js владелицы;
     • normalizeSteamData()  — сырой ответ будущего Worker.

   В Worker нет «вкусовых» решений: он только отдаёт API-ответы.
   Здесь, в браузере, применяются assets/data/rules.json, словарь
   жанров и расчёты для интерфейса.
   ========================================================= */
(function (root) {
  "use strict";

  var SCHEMA_VERSION = 1;

  function isObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  function string(value, fallback, maxLength) {
    if (typeof value !== "string") return fallback === undefined ? "" : fallback;
    var text = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    return text.slice(0, maxLength || 240);
  }

  function number(value, fallback) {
    var result = typeof value === "number" ? value : Number(value);
    return isFinite(result) ? result : (fallback === undefined ? 0 : fallback);
  }

  function nonNegative(value) {
    return Math.max(0, number(value, 0));
  }

  function positiveInt(value) {
    var result = Math.floor(number(value, 0));
    return result > 0 ? result : null;
  }

  function dateFromUnix(value) {
    var seconds = positiveInt(value);
    if (!seconds) return null;
    var date = new Date(seconds * 1000);
    if (isNaN(date)) return null;
    return date.toISOString().slice(0, 10);
  }

  function isoDate(value) {
    if (typeof value !== "string") return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }

  function responseBody(value) {
    return isObject(value) && isObject(value.response) ? value.response : (value || {});
  }

  function profileFromRaw(raw) {
    if (!isObject(raw)) return {};
    if (isObject(raw.profile)) return raw.profile;
    var summary = responseBody(raw.summary);
    return Array.isArray(summary.players) ? (summary.players[0] || {}) : {};
  }

  function safeProfileUrl(value) {
    if (typeof value !== "string") return null;
    try {
      var url = new URL(value);
      var host = url.hostname.toLowerCase();
      if (url.protocol !== "https:" || (host !== "steamcommunity.com" && host !== "www.steamcommunity.com")) return null;
      if (!/^\/(?:id\/[^/]+|profiles\/\d{17})\/?$/.test(url.pathname)) return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function safeAvatarUrl(value) {
    if (typeof value !== "string" || !value) return null;
    // Статичная страница использует локальный файл; живой профиль — HTTPS-аватар Steam.
    if (/^(?:(?:\.\.\/)+)?assets\/img\/[\w.-]+\.(?:jpg|jpeg|png|webp)$/i.test(value)) return value;
    try {
      var url = new URL(value);
      if (url.protocol !== "https:") return null;
      var host = url.hostname.toLowerCase();
      return /(^|\.)steamstatic\.com$/.test(host) || /(^|\.)steamusercontent\.com$/.test(host)
        ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function uniqueStrings(values, max) {
    var seen = Object.create(null);
    var out = [];
    asArray(values).forEach(function (value) {
      var item = string(value, "", 80);
      if (!item || seen[item]) return;
      seen[item] = true;
      out.push(item);
    });
    return out.slice(0, max || out.length);
  }

  function rulePart(rules, key, fallback) {
    return isObject(rules) && isObject(rules[key]) ? rules[key] : fallback;
  }

  function trimRulePunctuation(name, punctuation) {
    var text = name;
    while (text && punctuation.indexOf(text.charAt(0)) !== -1) text = text.slice(1);
    while (text && punctuation.indexOf(text.charAt(text.length - 1)) !== -1) text = text.slice(0, -1);
    return text.trim();
  }

  function cleanName(value, rules, fallback) {
    var text = string(value, fallback || "Без названия", 200);
    var cleanup = rulePart(rules, "nameCleanup", {});
    try {
      if (cleanup.trademarkPattern) text = text.replace(new RegExp(cleanup.trademarkPattern, "g"), "");
      if (cleanup.editionSuffixPattern) text = text.replace(new RegExp(cleanup.editionSuffixPattern, "i"), "");
    } catch (_) {
      // Некорректный шаблон не должен ломать страницу; Python отловит его при сборке.
    }
    text = text.replace(/\s{2,}/g, " ");
    return trimRulePunctuation(text, string(cleanup.trailingPunctuation, " -–—:,", 20)) || fallback || "Без названия";
  }

  function isJunkGame(appid, name, rules) {
    var filters = rulePart(rules, "gameFilters", {});
    var ids = asArray(filters.skipAppids).map(function (id) { return String(id); });
    if (ids.indexOf(String(appid)) !== -1) return true;

    var low = String(name || "").toLowerCase();
    if (asArray(filters.skipNameParts).some(function (part) { return low.indexOf(String(part).toLowerCase()) !== -1; })) return true;

    return asArray(filters.testBranchPatterns).some(function (pattern) {
      try { return new RegExp(pattern, "i").test(low); } catch (_) { return false; }
    });
  }

  function genreValues(value) {
    if (typeof value === "string") return value.split(",");
    return asArray(value);
  }

  function translateGenres(value, rules) {
    var genreRules = rulePart(rules, "genres", {});
    var translate = isObject(genreRules.translate) ? genreRules.translate : {};
    var dropped = asArray(genreRules.drop).map(String);
    var max = positiveInt(genreRules.maxPerGame) || 2;
    var seen = Object.create(null);
    var out = [];

    genreValues(value).forEach(function (raw) {
      var source = string(raw, "", 80);
      var genre = string(translate[source] || source, "", 80);
      if (!genre || dropped.indexOf(genre) !== -1 || seen[genre]) return;
      seen[genre] = true;
      out.push(genre);
    });
    return out.slice(0, max);
  }

  function genreHintsFor(appid, seedGenres, rawHints) {
    var id = String(appid);
    if (isObject(seedGenres) && seedGenres[id]) return seedGenres[id];
    if (isObject(rawHints) && rawHints[id]) return rawHints[id];
    return [];
  }

  function normalGame(game, rules, recentMap, seedGenres, rawHints) {
    if (!isObject(game)) return null;
    var appid = positiveInt(game.appid);
    if (!appid) return null;

    var name = cleanName(game.name, rules, "App " + appid);
    if (isJunkGame(appid, name, rules)) return null;

    var genres = game.genres && asArray(game.genres).length
      ? translateGenres(game.genres, rules)
      : translateGenres(genreHintsFor(appid, seedGenres, rawHints), rules);

    var recent = recentMap && recentMap[appid];
    return {
      appid: appid,
      name: name,
      hours: Math.round(nonNegative(game.hours != null ? game.hours : number(game.playtime_forever, 0) / 60) * 10) / 10,
      hours2w: Math.round(nonNegative(game.hours2w != null ? game.hours2w : number(recent, 0) / 60) * 10) / 10,
      lastPlayed: isoDate(game.lastPlayed) || dateFromUnix(game.rtime_last_played),
      genres: genres
    };
  }

  function sortGames(games) {
    return games.sort(function (a, b) {
      return b.hours - a.hours || a.name.localeCompare(b.name, "ru");
    });
  }

  function genreHours(games) {
    var map = Object.create(null);
    games.filter(function (game) { return game.hours > 0 && game.genres.length; }).forEach(function (game) {
      var part = game.hours / game.genres.length;
      game.genres.forEach(function (genre) { map[genre] = (map[genre] || 0) + part; });
    });
    return Object.keys(map).map(function (name) {
      var hours = map[name];
      return { name: name, hours: hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10 };
    }).sort(function (a, b) { return b.hours - a.hours; });
  }

  function normalGenreHours(rows) {
    return asArray(rows).map(function (row) {
      if (!isObject(row)) return null;
      var name = string(row.name, "", 80);
      return name ? { name: name, hours: nonNegative(row.hours) } : null;
    }).filter(Boolean).sort(function (a, b) { return b.hours - a.hours; });
  }

  function biggestAppid(games) {
    var played = games.filter(function (game) { return game.hours > 0; });
    return played.length ? played[0].appid : null;
  }

  function normalizedMeta(meta, fallback) {
    meta = isObject(meta) ? meta : {};
    return {
      persona: string(meta.persona || meta.personaname, fallback || "steam profile", 80),
      profileUrl: safeProfileUrl(meta.profileUrl || meta.profileurl),
      avatar: safeAvatarUrl(meta.avatarfull || meta.avatarmedium || meta.avatar),
      source: string(meta.source, "steam-api", 30),
      generatedAt: isoDate(meta.generatedAt || meta.fetchedAt) || new Date().toISOString().slice(0, 10),
      memberSince: isoDate(meta.memberSince) || dateFromUnix(meta.timecreated)
    };
  }

  function normalizeStaticData(input, rules) {
    input = isObject(input) ? input : {};
    var games = sortGames(asArray(input.games).map(function (game) {
      return normalGame(game, rules, null, null, null);
    }).filter(Boolean));
    var totals = isObject(input.totals) ? input.totals : {};
    var played = games.filter(function (game) { return game.hours > 0; });
    var backlog = games.filter(function (game) { return game.hours === 0; });
    var soulmate = positiveInt(input.soulmateAppid);
    if (!games.some(function (game) { return game.appid === soulmate; })) soulmate = biggestAppid(games);

    return {
      schemaVersion: SCHEMA_VERSION,
      meta: normalizedMeta(input.meta),
      totals: {
        // Статичный data.js может не хранить все игры по именам, поэтому его
        // проверенные Python-итоги приоритетнее локального пересчёта.
        gamesOwned: Math.round(nonNegative(totals.gamesOwned != null ? totals.gamesOwned : games.length)),
        hoursTotal: Math.round(nonNegative(totals.hoursTotal != null ? totals.hoursTotal : played.reduce(function (sum, game) { return sum + game.hours; }, 0))),
        hoursTwoWeeks: Math.round(nonNegative(totals.hoursTwoWeeks != null ? totals.hoursTwoWeeks : games.reduce(function (sum, game) { return sum + game.hours2w; }, 0))),
        gamesPlayed: Math.round(nonNegative(totals.gamesPlayed != null ? totals.gamesPlayed : played.length)),
        gamesNeverPlayed: Math.round(nonNegative(totals.gamesNeverPlayed != null ? totals.gamesNeverPlayed : backlog.length))
      },
      soulmateAppid: soulmate,
      genreHours: normalGenreHours(input.genreHours),
      games: games
    };
  }

  function normalizeSteamData(raw, rules, seedGenres) {
    raw = isObject(raw) ? raw : {};
    var profile = profileFromRaw(raw);
    var owned = responseBody(raw.owned || raw.ownedGames);
    var recent = responseBody(raw.recent || raw.recentGames);
    var recentMap = Object.create(null);
    asArray(recent.games).forEach(function (game) {
      var appid = positiveInt(game && game.appid);
      if (appid) recentMap[appid] = nonNegative(game.playtime_2weeks);
    });

    // SteamSpy возвращает одну сырую строку genre. Worker передаёт её как
    // genreHints; перевод и исключение меток происходят только здесь.
    var rawHints = isObject(raw.genreHints) ? raw.genreHints : {};
    var games = sortGames(asArray(owned.games).map(function (game) {
      return normalGame(game, rules, recentMap, seedGenres, rawHints);
    }).filter(Boolean));
    var played = games.filter(function (game) { return game.hours > 0; });
    var backlog = games.filter(function (game) { return game.hours === 0; });

    return {
      schemaVersion: SCHEMA_VERSION,
      meta: normalizedMeta(profile),
      totals: {
        // Для чужого профиля все записи пришли одним ответом, поэтому цифры
        // всегда считаются после общих фильтров, а не берутся из API game_count.
        gamesOwned: games.length,
        hoursTotal: Math.round(played.reduce(function (sum, game) { return sum + game.hours; }, 0)),
        hoursTwoWeeks: Math.round(games.reduce(function (sum, game) { return sum + game.hours2w; }, 0)),
        gamesPlayed: played.length,
        gamesNeverPlayed: backlog.length
      },
      soulmateAppid: biggestAppid(games),
      genreHours: genreHours(games),
      games: games,
      genreCoverage: {
        hoursKnown: Math.round(played.filter(function (game) { return game.genres.length; })
          .reduce(function (sum, game) { return sum + game.hours; }, 0)),
        hoursTotal: Math.round(played.reduce(function (sum, game) { return sum + game.hours; }, 0))
      }
    };
  }

  function soulmateUnit(game, rules) {
    var units = rulePart(rules, "soulmateUnits", {});
    var byAppid = isObject(units.byAppid) ? units.byAppid : {};
    var candidate = byAppid[String(game && game.appid)];
    var name = String((game && game.name) || "").toLowerCase();
    var genres = asArray(game && game.genres);

    if (!candidate) {
      candidate = asArray(units.byNamePattern).filter(function (rule) {
        try { return isObject(rule) && new RegExp(rule.pattern, "i").test(name); } catch (_) { return false; }
      })[0];
    }
    if (!candidate) {
      candidate = asArray(units.byGenre).filter(function (rule) {
        return isObject(rule) && genres.indexOf(rule.genre) !== -1;
      })[0];
    }
    candidate = candidate || units.fallback || { minutes: 120, word: "вечеров", note: "по два часа" };

    return {
      min: Math.max(1, nonNegative(candidate.minutes) || 120),
      word: string(candidate.word, "вечеров", 40),
      note: string(candidate.note, "по два часа", 160)
    };
  }

  function validateProfileInput(value) {
    var input = string(value, "", 400);
    if (/^\d{17}$/.test(input)) return { kind: "steamid", value: input };
    // Числовой ввод — только SteamID64; в противном случае это, вероятно,
    // опечатка, а не vanity-ник.
    if (/^\d+$/.test(input)) return null;
    if (/^[A-Za-z0-9_-]{2,64}$/.test(input)) return { kind: "vanity", value: input };

    try {
      var url = new URL(input);
      var host = url.hostname.toLowerCase();
      if ((url.protocol !== "https:" && url.protocol !== "http:") ||
          (host !== "steamcommunity.com" && host !== "www.steamcommunity.com")) return null;
      var profile = /^\/profiles\/(\d{17})\/?$/.exec(url.pathname);
      if (profile) return { kind: "steamid", value: profile[1] };
      var vanity = /^\/id\/([A-Za-z0-9_-]{2,64})\/?$/.exec(url.pathname);
      if (vanity) return { kind: "vanity", value: vanity[1] };
    } catch (_) { /* invalid URL */ }
    return null;
  }

  function loadRules(url) {
    return fetch(url, { credentials: "same-origin" }).then(function (response) {
      if (!response.ok) throw new Error("rules.json не загрузился: HTTP " + response.status);
      return response.json();
    }).then(function (rules) {
      if (!isObject(rules) || rules.schemaVersion !== SCHEMA_VERSION) {
        throw new Error("неподдерживаемый формат rules.json");
      }
      return rules;
    });
  }

  var api = {
    schemaVersion: SCHEMA_VERSION,
    loadRules: loadRules,
    validateProfileInput: validateProfileInput,
    normalizeStaticData: normalizeStaticData,
    normalizeSteamData: normalizeSteamData,
    soulmateUnit: soulmateUnit,
    cleanName: cleanName,
    isJunkGame: isJunkGame,
    translateGenres: translateGenres
  };

  root.SteamWrappedData = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
