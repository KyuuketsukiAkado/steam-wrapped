"use strict";

/* Офлайн-проверка общего слоя данных — без сети и браузера.
   Запуск: node tools/test_profile_data.js */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const Data = require(path.join(root, "assets/js/profile-data.js"));
const rules = JSON.parse(fs.readFileSync(path.join(root, "assets/data/rules.json"), "utf8"));

function readStaticData() {
  const text = fs.readFileSync(path.join(root, "assets/js/data.js"), "utf8");
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

// Статичная владелица продолжает получать свои числа и Dota-факт без Worker.
const mine = Data.normalizeStaticData(readStaticData(), rules);
assert.equal(mine.meta.persona, "mormyszka");
assert.equal(mine.totals.gamesOwned, 323);
assert.equal(mine.totals.hoursTotal, 8000);
assert.equal(mine.soulmateAppid, 570);
assert.equal(Data.soulmateUnit(mine.games[0], rules).word, "матчей");
assert.equal(Data.soulmateUnit(mine.games[0], rules).min, 38);

// Edge case из обсуждения: Stardew — фермерские дни, не «катки».
assert.deepEqual(Data.soulmateUnit({ appid: 413150, name: "Stardew Valley", genres: ["Инди"] }, rules), {
  min: 14,
  word: "фермерских дней",
  note: "примерно по 14 минут игрового времени каждый"
});

// Сырой ответ будущего Worker: фильтры, жанры и время применяются в браузере.
const friend = Data.normalizeSteamData({
  summary: { response: { players: [{
    steamid: "76561198000000000",
    personaname: "<img src=x onerror=alert(1)>",
    profileurl: "https://steamcommunity.com/id/safe_name/",
    avatarfull: "https://avatars.steamstatic.com/avatar.jpg",
    timecreated: 1485993600
  }] } },
  owned: { response: { game_count: 3, games: [
    { appid: 431960, name: "Wallpaper Engine", playtime_forever: 999999 },
    { appid: 730, name: "Counter-Strike 2™", playtime_forever: 120, rtime_last_played: 1756600000 },
    { appid: 999999, name: "<b>Very Real Game</b> - Complete Edition", playtime_forever: 60 }
  ] } },
  recent: { response: { games: [{ appid: 730, playtime_2weeks: 30 }] } },
  genreHints: { "730": "Action, Free To Play", "999999": "Indie, Strategy" }
}, rules, { "730": ["Экшен"] });

assert.equal(friend.games.length, 2, "служебный софт должен отсеяться");
assert.equal(friend.totals.gamesOwned, 2, "для живого профиля итог считается после фильтров");
assert.equal(friend.totals.hoursTotal, 3);
assert.equal(friend.totals.hoursTwoWeeks, 1);
assert.equal(friend.games[0].name, "Counter-Strike 2");
assert.equal(friend.games[0].hours2w, 0.5);
assert.equal(friend.games[1].name, "<b>Very Real Game</b>", "данные остаются строкой, рендерер вставит textContent");
assert.deepEqual(friend.games[0].genres, ["Экшен"]);
assert.deepEqual(friend.games[1].genres, ["Инди", "Стратегия"]);
assert.equal(friend.meta.persona, "<img src=x onerror=alert(1)>");
assert.equal(friend.meta.profileUrl, "https://steamcommunity.com/id/safe_name/");
assert.equal(friend.meta.avatar, "https://avatars.steamstatic.com/avatar.jpg");

assert.deepEqual(Data.validateProfileInput("76561198000000000"), { kind: "steamid", value: "76561198000000000" });
assert.deepEqual(Data.validateProfileInput("https://steamcommunity.com/id/K_Ak4d0/?xml=1"), { kind: "vanity", value: "K_Ak4d0" });
assert.equal(Data.validateProfileInput("7656119800000000"), null);
assert.equal(Data.validateProfileInput("https://example.com/anything"), null);
assert.equal(Data.validateProfileInput("https://steamcommunity.com/id/foo/extra"), null);

console.log("✓ profile-data: статичный и живой профиль, Stardew, фильтры, жанры и безопасный ввод");
