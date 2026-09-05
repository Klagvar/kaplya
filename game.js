/* Капля — гиперказуальная аркада на заполнение.
 *
 * Полное описание замысла, механик, кривой сложности и удержания —
 * в games/kaplya/ТЗ.md. Здесь только то, что нужно, чтобы понять код.
 *
 * Ядро: тап ставит каплю, она растёт сама, второй тап её замораживает.
 * Площадь растёт как квадрат радиуса, а риск — линейно со временем,
 * поэтому игроку всегда хочется подождать ещё чуть-чуть. Вся игра —
 * обслуживание этого чувства.
 *
 * Единственное правило поля: тёплое убивает, холодное останавливает.
 * Оно не знает исключений — ни угли не холодеют с глубиной, ни скины
 * не бывают тёплыми. Читаемость важнее красоты.
 *
 * Разнообразие добавляется не новыми кнопками, а новыми обстоятельствами:
 * ввод у игры один на всю игру — тап.
 *
 * Синтаксис консервативный (var, без стрелок и ?.): ВК крутит игры
 * в WebView на старых Android.
 */
(function (global) {
  'use strict';

  var P = global.Platform;
  var S = global.Sound;
  var A = global.Analytics;

  /* --- Локализация ---------------------------------------------------
     Свой словарь, а не engine/i18n.js: тот занят строками Орбиты и общий
     на все игры. Трогать его нельзя — Орбита на модерации, и правка
     общего движка поедет в её следующую сборку. */

  var DICT = {
    ru: {
      title: 'КАПЛЯ',
      hint: 'Тап — поставить каплю. Ещё тап — застыть.',
      warn: 'Не касайся углей',
      play: 'Играть',
      shop: 'Лавка',
      tabUp: 'Прокачка',
      tabSkin: 'Скины',
      maxed: 'Максимум',
      back: 'Назад',
      best: 'Рекорд',
      deepest: 'Глубина',
      newBest: 'Новый рекорд!',
      gameOver: 'Лопнула',
      again: 'Ещё раз',
      continueAd: 'Продолжить',
      forAd: 'за рекламу',
      level: 'Уровень',
      loading: 'Загрузка…',
      sound: 'Звук',
      on: 'вкл',
      off: 'выкл',
      cleared: 'Уровень пройден',
      clean: 'Чисто!',
      lifeUp: '+1 жизнь',
      equipped: 'Надет',
      equip: 'Надеть',
      need: 'Нужно',
      tapHere: 'Нажми сюда',
      tapStop: 'Нажми ещё раз, чтобы остановить',
      seeComet: 'Комета не ждёт',
      seePend: 'Маятник ходит по кругу',
      seePulse: 'Пульсар дышит',
      seeWall: 'Барьеры держат каплю',
      seeSleep: 'Не всё, что не движется, спит вечно',
      seePearl: 'Накрой жемчужину — получишь монету'
    },
    en: {
      title: 'DROPLET',
      hint: 'Tap to place a drop. Tap again to freeze.',
      warn: 'Never touch the embers',
      play: 'Play',
      shop: 'Store',
      tabUp: 'Upgrades',
      tabSkin: 'Skins',
      maxed: 'Maxed',
      back: 'Back',
      best: 'Best',
      deepest: 'Depth',
      newBest: 'New record!',
      gameOver: 'Popped',
      again: 'Retry',
      continueAd: 'Continue',
      forAd: 'for an ad',
      level: 'Level',
      loading: 'Loading…',
      sound: 'Sound',
      on: 'on',
      off: 'off',
      cleared: 'Level cleared',
      clean: 'Flawless!',
      lifeUp: '+1 life',
      equipped: 'Equipped',
      equip: 'Equip',
      need: 'Need',
      tapHere: 'Tap here',
      tapStop: 'Tap again to stop it',
      seeComet: 'A comet will not wait',
      seePend: 'The pendulum runs in circles',
      seePulse: 'The pulsar breathes',
      seeWall: 'Barriers hold the drop',
      seeSleep: 'Not everything still is asleep',
      seePearl: 'Cover a pearl to earn a coin'
    }
  };

  var RU_LANGS = { ru: 1, be: 1, kk: 1, uk: 1, uz: 1 };

  var T = {
    dict: DICT.ru,
    use: function (lang) {
      var code = (lang || 'ru').slice(0, 2).toLowerCase();
      this.dict = RU_LANGS[code] ? DICT.ru : DICT.en;
    },
    t: function (key) {
      var v = this.dict[key];
      return v === undefined ? key : v;
    }
  };

  /* --- Константы мира ------------------------------------------------
     Поле фиксированного логического размера, вписывается в экран с
     полями. Так сложность одинакова и на телефоне, и на мониторе:
     иначе на широком экране площадь больше, а цель в процентах — та же. */

  var FIELD_W = 400;
  var FIELD_H = 600;
  var FIELD_AREA = FIELD_W * FIELD_H;

  var MIN_R = 7;           // радиус только что поставленной капли
  var MAX_R = 92;          // дальше не растёт, застывает сама
  var GROW_BASE = 26;      // ед/с у маленькой капли
  var GROW_ACC = 0.5;      // прибавка к скорости с ростом радиуса

  var LIVES_START = 3;
  var LIVES_MAX = 5;
  var LIFE_LEVELS = { 5: 1, 10: 1, 15: 1, 20: 1 };
  var INTERSTITIAL_EVERY = 3;

  var WALL_HALF = 3.5;     // половина толщины барьера
  var PEARL_R = 8;
  var SLEEP_WAKE_DIST = 70;
  var SLEEP_DELAY = 0.45;  // фора игроку между пробуждением и движением
  var NEAR_MISS = 12;

  // Уровни, с которых механика входит в игру. Одна новинка за раз —
  // между вводами есть пауза, чтобы игрок успел понять предыдущую.
  var FROM_PEARL = 3;
  var FROM_COMET = 4;
  var FROM_PEND = 6;
  var FROM_PULSAR = 8;
  var FROM_WALL = 11;
  var FROM_SLEEP = 12;

  var TAU = Math.PI * 2;
  var LB_NAME = 'kaplya_best';
  var SAVE_KEY = 'kaplya';

  /* --- Палитра -------------------------------------------------------
     Вода холодеет и мрачнеет с глубиной: тон поля смещается от бирюзы
     к багрянцу. Это самый дешёвый способ показать прогресс — игрок
     видит, что зашёл далеко, ещё до того, как посмотрит на цифру.

     Угли из этой схемы исключены намеренно. Тёплый — единственный цвет,
     значение которого зафиксировано, и он не зависит ни от глубины,
     ни от скина. */

  function waterHue(lv) { return 168 + Math.min((lv - 1) * 10, 165); }

  function hsla(h, s, l, a) {
    return 'hsla(' + Math.round(h) + ',' + s + '%,' + l + '%,' + a + ')';
  }

  // Угли. Всегда одни и те же, при любой глубине.
  var EMBER_CORE = '#fff3d8';
  var EMBER_MID = '#ffb648';
  var EMBER_GLOW = 'rgba(255,107,53,0.55)';
  var EMBER_DIM = 'rgba(255,150,80,0.42)';   // спящая искра

  /* Скины меняют только цвет капель. Тёплых среди них нет и быть не
     может — иначе сломается единственное правило игры.
     «Роса» подстраивается под глубину: у бесплатного скина капли
     светлеют и холодеют вместе с водой. */
  var SKINS = [
    { cost: 0,   adaptive: true, ru: 'Роса',    en: 'Dew' },
    { cost: 60,  hue: 195,       ru: 'Иней',    en: 'Frost' },
    { cost: 140, hue: 145,       ru: 'Мята',    en: 'Mint' },
    { cost: 260, hue: 305,       ru: 'Неон',    en: 'Neon' },
    { cost: 450, hue: 265, extra: true, ru: 'Плазма', en: 'Plasma' }
  ];

  /* --- Прокачка --------------------------------------------------------
     Первая редакция ТЗ запрещала покупки, влияющие на сложность: боялись
     скатиться в гринд. Это оказалось неверно — скины дают повод копить,
     но не дают цели, и на второй сессии копить становится незачем.

     Постоянный рост возвращает смысл монетам, поэтому запрет снят. Чтобы
     он не сломал игру, соблюдены два условия: ни одна прокачка не
     отменяет смерть от угля, и все они упираются в потолок за разумное
     число забегов. Прокачка делает игрока увереннее, а не бессмертнее. */
  var UPGRADES = [
    { key: 'life', max: 3, cost: [30, 80, 170],
      ru: 'Живучесть', en: 'Vitality',
      ruSub: '+1 жизнь в начале забега', enSub: '+1 starting life' },
    { key: 'size', max: 3, cost: [25, 70, 150],
      ru: 'Натяжение', en: 'Tension',
      ruSub: 'капля вырастает крупнее', enSub: 'drops grow larger' },
    { key: 'calm', max: 3, cost: [30, 85, 175],
      ru: 'Хладнокровие', en: 'Composure',
      ruSub: 'капля разгоняется медленнее', enSub: 'growth speeds up slower' },
    { key: 'pearl', max: 2, cost: [40, 110],
      ru: 'Чутьё', en: 'Instinct',
      ruSub: 'жемчужина ловится издалека', enSub: 'pearls collect from farther' }
  ];

  /* --- Состояние ------------------------------------------------------ */

  var core = null;
  var state = 'boot';      // boot | menu | play | dead | shop
  var W = 0, H = 0;
  var scale = 1;
  var ox = 0, oy = 0;
  var us = 1;

  var drops = [];
  var hazards = [];
  var walls = [];
  var pearls = [];
  var parts = [];
  var waves = [];
  var motes = [];          // фоновые пузырьки, поднимаются со дна
  var growing = null;

  var level = 1;
  var lives = LIVES_START;
  var score = 0;
  var runCoins = 0;
  var streak = 0;
  var lostThisLevel = 0;
  var filled = 0;
  var target = 0;
  var continueUsed = false;
  var newBest = false;

  /* --- Учёт для аналитики ---------------------------------------------
     Всё, что нужно, чтобы по цифрам понимать чужой забег так же, как свой:
     когда он начался, сколько кадров успел нарисовать, какие механики
     игрок реально застал и предлагали ли ему ролик. */
  var runAt = 0;
  var runFrames = 0;
  var runPlaySec = 0;
  var runs = 0;            // забегов за эту сессию, а не за всю жизнь
  // Имя не seen: в save уже есть своё seen — там отмечены показанные
  // подсказки, и путать эти две вещи в отчёте будет дорого.
  var runSeen = {};
  var adOffer = false;     // предложение продолжения уже засчитано
  var adBusy = false;      // ролик заказан, второй раз не заказываем

  var flash = 0;           // вспышка «уровень пройден»
  var flashText = '';
  var shake = 0;
  var hintText = '';
  var hintTime = 0;
  var placedEver = 0;      // сколько капель поставлено за всё время
  var frozeEver = 0;

  var save = {
    best: 0, bestLevel: 1, coins: 0, skin: 0, owned: [1, 0, 0, 0, 0],
    up: { life: 0, size: 0, calm: 0, pearl: 0 },
    sound: 1, runs: 0, seen: {}
  };

  // Клавиатурный прицел: Core присылает пробел без координат.
  var kb = { on: false, t: 0, x: 0, y: 0 };

  var shopTab = 'up';   // up | skin

  var buttons = [];

  /* --- Мелкие помощники ---------------------------------------------- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* Пузырьки, поднимающиеся со дна. Дешёвый и самый действенный способ
     сказать «это под водой»: пока на поле не поднимается воздух, любая
     заливка остаётся прямоугольником, а круги на ней — кругами. */
  function makeMotes() {
    motes = [];
    for (var i = 0; i < 34; i++) {
      motes.push({
        x: rnd(6, FIELD_W - 6), y: rnd(0, FIELD_H),
        r: rnd(1.6, 5.4), sp: rnd(9, 26), ph: rnd(0, TAU)
      });
    }
  }

  function moveMotes(dt, t) {
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      m.y -= m.sp * dt;
      m.x += Math.sin(t * 0.7 + m.ph) * 6 * dt;
      if (m.y < -m.r) { m.y = FIELD_H + m.r; m.x = rnd(6, FIELD_W - 6); }
    }
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

  /* Расстояние от точки до отрезка и нормаль от отрезка к точке.
     Нужно и для роста капли у барьера, и для отскока углей. */
  function segInfo(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var len2 = dx * dx + dy * dy;
    var t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    var cx = x1 + dx * t, cy = y1 + dy * t;
    var ddx = px - cx, ddy = py - cy;
    var d = Math.hypot(ddx, ddy);
    return { d: d, nx: d > 0.0001 ? ddx / d : 1, ny: d > 0.0001 ? ddy / d : 0, cx: cx, cy: cy };
  }

  function skinColors(lv) {
    var sk = SKINS[save.skin] || SKINS[0];
    var hue = sk.adaptive ? waterHue(lv) : sk.hue;
    return {
      hue: hue,
      extra: !!sk.extra,
      core: hsla(hue, 100, 96, 1),
      mid: hsla(hue, 72, 66, 1),
      edge: hsla(hue, 70, 42, 0.75),
      glow: hsla(hue, 85, 60, sk.extra ? 0.75 : 0.5),
      rim: hsla(hue, 100, 92, 0.72)
    };
  }

  /* --- Формулы сложности ---------------------------------------------
     Все числа сложности живут здесь и больше нигде, чтобы их можно было
     крутить, не читая остальной код. Соответствуют разделу 7 ТЗ. */

  function goalOf(lv) { return Math.min(0.36 + lv * 0.018, 0.62); }
  function speedOf(lv) { return Math.min(50 + lv * 5, 145); }

  /* Общий бюджет опасности. Считать каждый тип отдельно нельзя: к
     двенадцатому уровню независимые счётчики складывались в тринадцать
     тёплых объектов, и на поле не оставалось места, куда вообще можно
     лить. Бюджет ставит потолок на всё сразу, а искры работают
     наполнителем — их досыпают ровно столько, сколько осталось. */
  function dangerBudget(lv) { return Math.min(4 + Math.floor(lv * 0.28), 8); }

  function nSparks(lv) { return Math.min(2 + Math.round(lv * 0.5), 7); }
  function nComets(lv) { return lv < FROM_COMET ? 0 : Math.min(1 + Math.floor((lv - FROM_COMET) / 5), 2); }
  function nPends(lv) { return lv < FROM_PEND ? 0 : Math.min(1 + Math.floor((lv - FROM_PEND) / 6), 2); }
  function nPulsars(lv) { return lv < FROM_PULSAR ? 0 : Math.min(1 + Math.floor((lv - FROM_PULSAR) / 7), 2); }
  function nWalls(lv) { return lv < FROM_WALL ? 0 : Math.min(1 + Math.floor((lv - FROM_WALL) / 7), 2); }
  function nSleepers(lv) { return lv < FROM_SLEEP ? 0 : Math.min(1 + Math.floor((lv - FROM_SLEEP) / 5), 2); }
  function nPearls(lv) { return lv < FROM_PEARL ? 0 : Math.min(1 + Math.floor((lv - FROM_PEARL) / 6), 3); }

  function multiplier() { return 1 + 0.1 * Math.min(streak, 10); }

  /* Действующие значения с учётом прокачки. Везде в коде используются
     только они — сырые константы остаются базой и нигде не читаются
     напрямую, иначе прокачка начнёт работать через раз. */
  function upLvl(key) { return (save.up && save.up[key]) || 0; }
  function maxR() { return MAX_R + upLvl('size') * 7; }
  function growAcc() { return GROW_ACC - upLvl('calm') * 0.06; }
  function startLives() { return LIVES_START + upLvl('life'); }
  function livesMax() { return Math.min(startLives() + 2, 8); }
  function pearlReach() { return upLvl('pearl') * 16; }

  function upCost(u) {
    var lv = upLvl(u.key);
    return lv >= u.max ? 0 : u.cost[lv];
  }

  /* --- Сохранение ----------------------------------------------------- */

  function persist() { P.save(save, SAVE_KEY); }

  function hint(key) {
    if (save.seen[key]) return;
    save.seen[key] = 1;
    hintText = T.t(key);
    hintTime = 2.5;
    persist();
  }

  /* --- Генерация уровня ------------------------------------------------
     Уровни не рисуются руками, а собираются из формул выше. Ручные
     уровни в игре, где сессия длится минуту, не окупаются: игрок
     увидит их один раз. */

  function freeSpot(minWall, minFromWalls) {
    // Ищем точку подальше от барьеров. Больше 30 попыток не делаем:
    // на тесном поле идеального места может не быть вовсе, и тогда
    // лучше поставить объект чуть неудобно, чем зациклиться.
    for (var i = 0; i < 30; i++) {
      var x = rnd(minWall, FIELD_W - minWall);
      var y = rnd(minWall, FIELD_H - minWall);
      var ok = true;
      for (var j = 0; j < walls.length; j++) {
        var w = walls[j];
        if (segInfo(x, y, w.x1, w.y1, w.x2, w.y2).d < minFromWalls) { ok = false; break; }
      }
      if (ok) return { x: x, y: y };
    }
    return { x: FIELD_W / 2, y: FIELD_H / 2 };
  }

  /* --- Компоновки уровня -------------------------------------------------
     Барьеры не рассыпаются случайно, а собираются из готовых компоновок.
     Случайная сыпь даёт уровни, неотличимые друг от друга: игрок видит
     «опять какие-то палки». Узнаваемая форма — коридор, крест, гребёнка —
     читается как задача, у неё есть решение, и её можно вспомнить.

     Координаты даны в поле 400×600 и держатся не ближе 55 от стенок:
     по периметру всегда остаётся проход, и ни одна компоновка не может
     запереть угол. Дальше форма ещё и проверяется на проходимость
     упаковкой (раздел 7а ТЗ), так что это первый предохранитель, не
     единственный. */
  var LAYOUTS = [
    // Коридор: два вертикальных барьера, между ними канал.
    [[140, 150, 140, 430], [260, 190, 260, 470]],
    // Крест: делит поле на четыре кармана с проходами по краям.
    [[110, 300, 290, 300], [200, 190, 200, 410]],
    // Гребёнка: три уступа со сменой стороны.
    [[60, 190, 210, 190], [190, 330, 340, 330], [60, 460, 210, 460]],
    // Уголки: две буквы Г в противоположных углах.
    [[75, 165, 195, 165], [75, 165, 75, 275], [325, 445, 205, 445], [325, 445, 325, 335]],
    // Кольцо: разорванный квадрат в центре, вход через углы.
    [[145, 210, 255, 210], [145, 400, 255, 400], [145, 255, 145, 355], [255, 255, 255, 355]],
    // Лестница.
    [[70, 210, 200, 210], [200, 330, 330, 330], [70, 450, 200, 450]],
    // Диагональ: единственная длинная преграда наискось.
    [[95, 190, 305, 420]]
  ];

  function makeWalls(lv) {
    walls = [];
    if (lv < FROM_WALL) return;

    var tpl = LAYOUTS[Math.floor(Math.random() * LAYOUTS.length)];
    // Зеркало и небольшой сдвиг: форма узнаётся, но не повторяется
    // пиксель в пиксель, и заученного решения не возникает.
    var flip = Math.random() < 0.5;
    var jx = rnd(-16, 16), jy = rnd(-16, 16);

    for (var i = 0; i < tpl.length; i++) {
      var q = tpl[i];
      var x1 = flip ? FIELD_W - q[0] : q[0];
      var x2 = flip ? FIELD_W - q[2] : q[2];
      walls.push({
        x1: clamp(x1 + jx, 55, FIELD_W - 55), y1: clamp(q[1] + jy, 55, FIELD_H - 55),
        x2: clamp(x2 + jx, 55, FIELD_W - 55), y2: clamp(q[3] + jy, 55, FIELD_H - 55)
      });
    }
    // На первых уровнях с барьерами берём не всю компоновку целиком —
    // так переход от открытого поля к тесному не бьёт по игроку сразу.
    var keep = nWalls(lv) === 1 ? Math.max(1, Math.ceil(walls.length / 2)) : walls.length;
    walls.length = keep;
  }


  function pushSpark(lv, kind) {
    var sp = speedOf(lv) * (kind === 'comet' ? 1.9 : 1);
    var a = rnd(0, TAU);
    var r = kind === 'comet' ? rnd(7, 9) : rnd(9, 13);
    var p = freeSpot(r + 8, r + 14);
    hazards.push({
      type: kind, x: p.x, y: p.y,
      vx: Math.cos(a) * sp * rnd(0.85, 1.15),
      vy: Math.sin(a) * sp * rnd(0.85, 1.15),
      r: r, ph: rnd(0, TAU), trail: kind === 'comet' ? [] : null
    });
  }

  function pushPendulum(lv) {
    var orbit = rnd(60, 130);
    var p = freeSpot(orbit + 20, 20);
    var w = (rnd(0.55, 1.0) + lv * 0.012) * (Math.random() < 0.5 ? -1 : 1);
    hazards.push({
      type: 'pend', cx: p.x, cy: p.y, orbit: orbit,
      ang: rnd(0, TAU), w: w, r: 11, ph: rnd(0, TAU),
      x: p.x + orbit, y: p.y
    });
  }

  function pushPulsar(lv) {
    var p = freeSpot(60, 50);
    hazards.push({
      type: 'pulsar', x: p.x, y: p.y,
      rMin: 8, rMax: 46, r: 8,
      phase: rnd(0, TAU), period: Math.max(1.5, 2.2 - lv * 0.02), ph: 0
    });
  }

  function pushSleeper(lv) {
    var p = freeSpot(24, 24);
    hazards.push({
      type: 'sleep', x: p.x, y: p.y, r: 11,
      st: 'sleep', wake: 0, vx: 0, vy: 0, ph: rnd(0, TAU),
      speed: speedOf(lv) * 0.8
    });
  }

  /* --- Проверка проходимости --------------------------------------------
     Уровни генерируются, а генератор обязан отвечать за свой результат:
     набор барьеров и неподвижных препятствий может физически не оставить
     на поле места под нужный процент, и тогда игрок проигрывает не по
     своей вине. Это худший вид сложности — несправедливая.

     Считаем ёмкость поля жадной упаковкой: раз за разом ищем точку с
     наибольшим запасом до всего вокруг и ставим туда круг такого же
     радиуса. Идеальную упаковку это не даёт, зато даёт честную нижнюю
     оценку — а нам и нужна нижняя. */

  function clearanceAt(x, y, placed) {
    var d = Math.min(x, y, FIELD_W - x, FIELD_H - y);
    var i;
    for (i = 0; i < walls.length; i++) {
      var w = walls[i];
      d = Math.min(d, segInfo(x, y, w.x1, w.y1, w.x2, w.y2).d - WALL_HALF);
      if (d <= 0) return 0;
    }
    // Пульсар в поджатом состоянии — единственный уголь, который стоит
    // на месте всегда. Остальные двигаются и место не занимают.
    for (i = 0; i < hazards.length; i++) {
      if (hazards[i].type !== 'pulsar') continue;
      d = Math.min(d, dist(x, y, hazards[i].x, hazards[i].y) - hazards[i].rMin);
      if (d <= 0) return 0;
    }
    for (i = 0; i < placed.length; i++) {
      d = Math.min(d, dist(x, y, placed[i].x, placed[i].y) - placed[i].r);
      if (d <= 0) return 0;
    }
    return d;
  }

  function packCapacity() {
    var placed = [];
    var total = 0;
    var lim = maxR();
    for (var n = 0; n < 22; n++) {
      var bestR = 0, bx = 0, by = 0;
      for (var x = 16; x < FIELD_W; x += 16) {
        for (var y = 16; y < FIELD_H; y += 16) {
          var r = clearanceAt(x, y, placed);
          if (r > bestR) { bestR = r; bx = x; by = y; }
        }
      }
      if (bestR < 16) break;
      var rr = Math.min(bestR, lim);
      placed.push({ x: bx, y: by, r: rr });
      total += Math.PI * rr * rr;
    }
    return total;
  }

  /* Расстановка угрозы отделена от setupLevel: при пересборке уровня её
     нужно повторять целиком, вместе с барьерами. */
  function spawnAll(lv) {
    hazards = [];
    // Порядок важен: сначала то, ради чего уровень интересен, потом
    // наполнитель. Если бюджет кончится, срежутся искры, а не пульсар —
    // механику, которую игрок пришёл смотреть, терять нельзя.
    var i;
    for (i = 0; i < nPulsars(lv); i++) pushPulsar(lv);
    for (i = 0; i < nPends(lv); i++) pushPendulum(lv);
    for (i = 0; i < nSleepers(lv); i++) pushSleeper(lv);
    for (i = 0; i < nComets(lv); i++) pushSpark(lv, 'comet');

    var room = dangerBudget(lv) - hazards.length;
    // Две искры есть всегда: поле без движения читается как пауза.
    var sparks = Math.max(2, Math.min(nSparks(lv), room));
    for (i = 0; i < sparks; i++) pushSpark(lv, 'spark');

    // Первый уровень раскладываем руками: угли внизу, подсказка сверху.
    // Игрок физически не может умереть до третьей капли, и это важнее
    // честной случайности — до объяснения правил смерть читается
    // как поломка игры, а не как проигрыш.
    if (lv === 1) {
      for (i = 0; i < hazards.length; i++) {
        hazards[i].y = rnd(FIELD_H * 0.62, FIELD_H - 30);
      }
    }
  }

  function setupLevel(lv) {
    /* Отмечаем, что игрок реально увидел, а не что положено по номеру
       уровня: смысл замера в том, добирается ли живой человек до
       содержания игры. В «Орбите» ответ оказался «нет», и хочется знать,
       так ли это здесь. */
    if (nPearls(lv) > 0) runSeen.pearl = 1;
    if (nComets(lv) > 0) runSeen.comet = 1;
    if (nPends(lv) > 0) runSeen.pend = 1;
    if (nPulsars(lv) > 0) runSeen.pulsar = 1;
    if (nWalls(lv) > 0) runSeen.wall = 1;
    if (nSleepers(lv) > 0) runSeen.sleep = 1;

    drops = [];
    pearls = [];
    hazards = [];
    walls = [];
    filled = 0;
    growing = null;
    lostThisLevel = 0;

    var want = goalOf(lv) * FIELD_AREA;
    var need = want * 1.18;

    if (nWalls(lv) === 0 && nPulsars(lv) === 0) {
      // Пустое поле вмещает заведомо больше любой нашей цели — считать
      // нечего, и незачем тратить кадр на упаковку.
      makeWalls(lv);
      spawnAll(lv);
      target = want;
    } else {
      // Пересобираем, пока ёмкость поля не покроет цель с запасом.
      // После нескольких неудач снимаем по барьеру: лучше уровень
      // попроще, чем уровень, который нельзя пройти в принципе.
      var cap = 0;
      for (var tryN = 0; tryN < 6; tryN++) {
        makeWalls(lv);
        if (tryN >= 3 && walls.length) walls.length = walls.length - 1;
        spawnAll(lv);
        cap = packCapacity();
        if (cap >= need) break;
      }
      if (cap < need) {
        walls = [];
        spawnAll(lv);
        cap = packCapacity();
      }
      // Цель не может превышать то, что физически влезает. С этим
      // клампом проходимость гарантируется по построению, а не по удаче.
      target = Math.min(want, cap * 0.8);
    }

    for (var i = 0; i < nPearls(lv); i++) {
      var p = freeSpot(34, 24);
      pearls.push({ x: p.x, y: p.y, taken: 0, ph: rnd(0, TAU) });
    }

    // Подсказки при первом появлении механики.
    if (lv === FROM_PEARL) hint('seePearl');
    if (lv === FROM_COMET) hint('seeComet');
    if (lv === FROM_PEND) hint('seePend');
    if (lv === FROM_PULSAR) hint('seePulse');
    if (lv === FROM_WALL) hint('seeWall');
    if (lv === FROM_SLEEP) hint('seeSleep');
  }


  /* --- Забег ----------------------------------------------------------- */

  function startRun() {
    runs++;
    runAt = Date.now();
    runFrames = 0;
    runPlaySec = 0;
    runSeen = {};
    A.event('run_start', { n: runs });
    // Пересборку канваса держим до конца забега: рекламный баннер выезжает
    // когда придётся, а перестраивать буфер кадра под руками у игрока нельзя.
    core.holdResize = true;

    level = 1;
    lives = startLives();
    score = 0;
    runCoins = 0;
    streak = 0;
    continueUsed = false;
    newBest = false;
    parts = [];
    waves = [];
    flash = 0;
    setupLevel(level);
    state = 'play';
    P.gameplayStart();
  }

  /* --- Частицы и волны -------------------------------------------------- */

  function burst(x, y, r, warm) {
    var n = Math.min(10 + Math.round(r * 0.5), 34);
    for (var i = 0; i < n; i++) {
      var a = rnd(0, TAU);
      var sp = rnd(40, 60) + r * 1.6;
      parts.push({
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: rnd(1.6, 3.6), life: rnd(0.35, 0.7), max: 0.7, warm: !!warm
      });
    }
  }

  function ripple(x, y, r) {
    waves.push({ x: x, y: y, r: r, max: r + 46, life: 0.55, dur: 0.55 });
  }

  /* --- Действия игрока -------------------------------------------------- */

  function placeAt(fx, fy) {
    if (fx < MIN_R || fy < MIN_R || fx > FIELD_W - MIN_R || fy > FIELD_H - MIN_R) return;

    // Внутрь застывшей капли или в барьер ставить нельзя. Это не риск,
    // а промах пальцем, и наказывать за него нечестно — просто игнорируем.
    var i;
    for (i = 0; i < drops.length; i++) {
      if (dist(fx, fy, drops[i].x, drops[i].y) < drops[i].r + MIN_R) return;
    }
    for (i = 0; i < walls.length; i++) {
      var w = walls[i];
      if (segInfo(fx, fy, w.x1, w.y1, w.x2, w.y2).d < WALL_HALF + MIN_R) return;
    }

    growing = { x: fx, y: fy, r: MIN_R, tick: 0, near: 0 };
    placedEver++;
    S.tone({ freq: 300, dur: 0.06, type: 'sine', gain: 0.3 });
  }

  function freeze() {
    if (!growing) return;
    var g = growing;
    growing = null;

    drops.push({ x: g.x, y: g.y, r: g.r, born: 0 });
    filled += Math.PI * g.r * g.r;
    frozeEver++;

    streak++;
    var mult = multiplier();
    // Не меньше очка за каплю: действие игрока никогда не должно
    // засчитываться как ноль, даже если он остановил её мгновенно.
    score += Math.max(1, Math.round(Math.PI * g.r * g.r / FIELD_AREA * 100 * mult));

    // Тон растёт с размером: ухо награждает за жадность раньше, чем
    // это делает глаз на шкале.
    var k = (g.r - MIN_R) / (maxR() - MIN_R);
    S.tone({ freq: 420 + k * 520, dur: 0.11, type: 'sine', gain: 0.55 });
    if (streak > 1 && streak <= 11) {
      S.tone({ freq: 620 + streak * 34, dur: 0.06, type: 'triangle', gain: 0.2 });
    }
    ripple(g.x, g.y, g.r);

    // Жемчужины собираются накрытием: центр внутри застывшей капли.
    for (var i = 0; i < pearls.length; i++) {
      var p = pearls[i];
      if (p.taken) continue;
      if (dist(p.x, p.y, g.x, g.y) < g.r + pearlReach()) {
        p.taken = 1;
        runCoins += 3;
        save.coins += 3;
        S.coin();
        burst(p.x, p.y, 14, false);
      }
    }

    if (filled >= target) levelUp();
  }

  function levelUp() {
    if (lostThisLevel === 0) {
      // Бонус за чистый уровень: единственная награда за осторожную
      // игру. Без него выгодно спамить мелкими каплями и не считать
      // потери.
      score += 25 * level;
      flashText = T.t('clean');
    } else {
      flashText = T.t('cleared');
    }

    // Монеты за пройденный уровень — основной доход. На одних жемчужинах
    // до первой покупки в лавке игрок шёл почти час, и прокачка не
    // работала как удержание вовсе: копить было незачем, потому что
    // накопить было нельзя.
    var pay = level + (lostThisLevel === 0 ? 5 : 0);
    runCoins += pay;
    save.coins += pay;

    level++;
    if (level > save.bestLevel) save.bestLevel = level;

    if (LIFE_LEVELS[level] && lives < livesMax()) {
      lives++;
      flashText = T.t('lifeUp');
    }

    flash = 1;
    S.reward();
    persist();
    setupLevel(level);
  }

  function pop() {
    var g = growing;
    growing = null;
    burst(g.x, g.y, g.r, false);
    shake = 1;
    streak = 0;
    lives--;
    lostThisLevel++;
    S.death();

    if (lives > 0) return;
    die();
  }

  function die() {
    state = 'dead';
    adOffer = false;
    P.gameplayStop();
    save.runs++;
    if (score > save.best) { save.best = score; newBest = true; }
    if (level > save.bestLevel) save.bestLevel = level;
    persist();
    if (score > 0) P.submitScore(LB_NAME, save.best);

    A.event('run_end', {
      n: runs, score: score, best: save.best,
      lvl: level, blvl: save.bestLevel, coins: runCoins,
      dur: Math.round((Date.now() - runAt) / 1000),
      cont: continueUsed ? 1 : 0,
      fps: runPlaySec > 1 ? Math.round(runFrames / runPlaySec) : 0,
      seen: runSeen
    });
    A.flush(false);

    // Забег кончился — можно пересобрать канвас и попросить баннер.
    core.releaseResize();
    showBanner('dead');

    // Обновляем доступность ролика к следующему экрану смерти: ответ
    // придёт асинхронно, текущий экран рисуется по прошлому значению.
    P.checkRewarded();

    if (save.runs % INTERSTITIAL_EVERY === 0) {
      P.showInterstitial().then(function (shown) {
        A.event('ad', adInfo('interstitial', 'dead', shown));
        A.flush(false);
      });
    }
  }

  /* Одно место, где собирается всё про показ рекламы: формат, откуда
     вызвали, показалось ли и код отказа от площадки. Кода мало — площадка
     присылает и причину словами, а списка кодов рекламных методов ВК нигде
     не опубликовано, так что расшифровку берём из ответа. */
  function adInfo(format, src, ok) {
    var o = { f: format, s: src, ok: ok ? 1 : 0, dev: P.deviceType || '?' };
    if (!ok && P.lastAdError !== undefined && P.lastAdError !== null) o.err = P.lastAdError;
    if (!ok && P.lastAdReason) o.why = String(P.lastAdReason).slice(0, 120);
    return o;
  }

  /* Повторы баннера приходится ограничивать: условие «не просить, если он
     уже висит» не спасает, когда баннер не появляется вообще — тогда мы
     просим на каждой смерти, и площадка отвечает «Requests limit reached»,
     заодно роняя и межэкранную рекламу. Проверено на «Орбите». */
  var BANNER_TRIES = 3;
  var BANNER_GAP = 60000;
  var bannerTries = 0;
  var bannerAt = 0;

  function showBanner(where) {
    if (P.bannerShown || bannerTries >= BANNER_TRIES) return;
    var now = Date.now();
    if (bannerAt && now - bannerAt < BANNER_GAP) return;
    bannerTries++;
    bannerAt = now;
    P.showBanner().then(function (shown) {
      A.event('ad', adInfo('banner', where, shown));
    });
  }

  /* Возвращение в забег после просмотренного ролика. Вынесено отдельно,
     потому что вызывается из двух мест: сразу после ролика и позже, если
     ответ площадки опоздал. */
  function revive() {
    continueUsed = true;
    core.holdResize = true;
    lives = 1;
    streak = 0;
    // Угли переставляем: иначе игрок воскресает вплотную к тому же
    // углю, который его только что лопнул, и теряет жизнь мгновенно.
    var keep = drops.slice();
    var keepFilled = filled;
    var keepPearls = pearls.slice();
    setupLevel(level);
    drops = keep;
    filled = keepFilled;
    pearls = keepPearls;
    state = 'play';
    P.gameplayStart();
  }

  /* Награда, подтверждённая уже после того, как игра перестала её ждать.
     Ролик человек посмотрел, значит своё получает: продолжением, если он
     ещё на экране смерти, и монетами, если уже убежал играть дальше —
     воскрешать посреди чужого забега нельзя. */
  function onLateReward() {
    A.event('ad', adInfo('reward', 'late', 1));
    A.flush(false);
    if (state === 'dead' && !continueUsed) {
      revive();
      return;
    }
    var bonus = runCoins > 0 ? runCoins : 1;
    save.coins += bonus;
    S.reward();
    persist();
  }

  function doContinue() {
    if (continueUsed || adBusy) return;
    /* Отметку ставим только после подтверждённого просмотра. Раньше она
       ставилась до показа, и неудачный ролик — а их у нас большинство —
       навсегда забирал у игрока единственную попытку продолжить. Заодно
       это ломало бы сам замер: мы бы считали отказы площадки отказами
       игрока.

       Взамен нужен свой замок от повторного нажатия, пока крутится ролик,
       иначе нетерпеливый игрок закажет показ дважды. */
    adBusy = true;
    P.showRewarded().then(function (ok) {
      adBusy = false;
      A.event('ad', adInfo('reward', 'continue', ok));
      A.flush(false);
      if (!ok) return;
      revive();
    }).catch(function () {
      // Что бы ни случилось с показом, экран смерти должен остаться живым.
      adBusy = false;
    });
  }

  /* --- Физика углей ------------------------------------------------------ */

  function bounceWalls(h) {
    if (h.x < h.r) { h.x = h.r; h.vx = Math.abs(h.vx); }
    if (h.x > FIELD_W - h.r) { h.x = FIELD_W - h.r; h.vx = -Math.abs(h.vx); }
    if (h.y < h.r) { h.y = h.r; h.vy = Math.abs(h.vy); }
    if (h.y > FIELD_H - h.r) { h.y = FIELD_H - h.r; h.vy = -Math.abs(h.vy); }
  }

  function bounceOff(h, cx, cy, minDist) {
    var dx = h.x - cx, dy = h.y - cy;
    var d = Math.hypot(dx, dy);
    if (d >= minDist || d < 0.0001) return;
    var nx = dx / d, ny = dy / d;
    h.x = cx + nx * minDist;
    h.y = cy + ny * minDist;
    var dot = h.vx * nx + h.vy * ny;
    if (dot < 0) { h.vx -= 2 * dot * nx; h.vy -= 2 * dot * ny; }
  }

  function moveHazards(dt) {
    for (var i = 0; i < hazards.length; i++) {
      var h = hazards[i];
      h.ph += dt * 4;

      if (h.type === 'pend') {
        h.ang += h.w * dt;
        h.x = h.cx + Math.cos(h.ang) * h.orbit;
        h.y = h.cy + Math.sin(h.ang) * h.orbit;
        continue;
      }

      if (h.type === 'pulsar') {
        var prev = h.r;
        h.phase += dt * TAU / h.period;
        h.r = h.rMin + (h.rMax - h.rMin) * (0.5 - 0.5 * Math.cos(h.phase));
        // Глухой удар в момент, когда пульсар начинает вдох.
        if (prev <= h.rMin + 0.6 && h.r > prev) S.tone({ freq: 90, dur: 0.16, type: 'sine', gain: 0.3 });
        continue;
      }

      if (h.type === 'sleep') {
        if (h.st === 'sleep') {
          if (growing && dist(growing.x, growing.y, h.x, h.y) < SLEEP_WAKE_DIST) {
            h.st = 'waking';
            h.wake = SLEEP_DELAY;
            var a = Math.atan2(growing.y - h.y, growing.x - h.x);
            h.vx = Math.cos(a) * h.speed;
            h.vy = Math.sin(a) * h.speed;
            S.tone({ freq: 180, slideTo: 420, dur: 0.18, type: 'sawtooth', gain: 0.25 });
          }
          continue;
        }
        if (h.st === 'waking') {
          // Фора: игрок уже нажал и не может отменить решение, поэтому
          // у него должно быть время среагировать вторым тапом.
          h.wake -= dt;
          if (h.wake <= 0) h.st = 'awake';
          continue;
        }
      }

      h.x += h.vx * dt;
      h.y += h.vy * dt;
      bounceWalls(h);

      // Комета летит над водой: она не отражается от застывших капель
      // и барьеров. Это её роль — от искры можно спрятаться за своей
      // же каплей, от кометы нельзя нигде.
      if (h.type === 'comet') {
        h.trail.push({ x: h.x, y: h.y, life: 0.32 });
        if (h.trail.length > 26) h.trail.shift();
        continue;
      }

      var j;
      for (j = 0; j < drops.length; j++) bounceOff(h, drops[j].x, drops[j].y, drops[j].r + h.r);
      for (j = 0; j < walls.length; j++) {
        var w = walls[j];
        var s = segInfo(h.x, h.y, w.x1, w.y1, w.x2, w.y2);
        if (s.d < WALL_HALF + h.r) bounceOff(h, s.cx, s.cy, WALL_HALF + h.r);
      }
    }
  }

  /* --- Рост капли -------------------------------------------------------- */

  function growDrop(dt) {
    var g = growing;
    // Скорость растёт вместе с радиусом: чем крупнее капля, тем труднее
    // остановить её точно. Кривая сложности живёт внутри одного тапа.
    g.r += (GROW_BASE + g.r * growAcc()) * dt;
    if (g.near > 0) g.near -= dt;

    var step = Math.floor((g.r - MIN_R) / 12);
    if (step > g.tick) {
      g.tick = step;
      S.tone({ freq: 260 + step * 46, dur: 0.04, type: 'triangle', gain: 0.16 });
    }

    // Стенка поля останавливает рост. Значит у края всегда безопасно,
    // но мелко — честный размен, а не бесплатный угол.
    var wallGap = Math.min(g.x, g.y, FIELD_W - g.x, FIELD_H - g.y);
    if (g.r >= wallGap) { g.r = wallGap; freeze(); return; }

    var i;
    for (i = 0; i < hazards.length; i++) {
      var h = hazards[i];
      var d = dist(g.x, g.y, h.x, h.y);
      if (d < g.r + h.r) { pop(); return; }
      // Близкий промах — игрок должен чувствовать, что ему повезло.
      if (d < g.r + h.r + NEAR_MISS) g.near = 0.25;
    }

    for (i = 0; i < walls.length; i++) {
      var w = walls[i];
      var s = segInfo(g.x, g.y, w.x1, w.y1, w.x2, w.y2);
      if (g.r + WALL_HALF > s.d) {
        g.r = Math.max(MIN_R, s.d - WALL_HALF);
        freeze();
        return;
      }
    }

    // Соседняя капля — не смерть, а стена. Иначе игра наказывала бы за
    // плотную упаковку, то есть за лучшую из возможных игр, и делала бы
    // это в конце уровня, когда поле и так тесное.
    for (i = 0; i < drops.length; i++) {
      var dr = drops[i];
      var dd = dist(g.x, g.y, dr.x, dr.y);
      if (dd < g.r + dr.r) {
        g.r = Math.max(MIN_R, dd - dr.r);
        freeze();
        return;
      }
    }

    if (g.r >= maxR()) { g.r = maxR(); freeze(); }
  }

  /* --- Кадр логики -------------------------------------------------------- */

  function update(dt) {
    /* Кадры забега считаем сами, и время копим своё, а не по часам: пока
       крутится ролик, кадров нет, и настенное время посчитало бы
       продолженные забеги медленными на ровном месте. */
    if (state === 'play') {
      runFrames++;
      runPlaySec += dt;
    }

    if (flash > 0) flash = Math.max(0, flash - dt * 1.6);
    if (shake > 0) shake = Math.max(0, shake - dt * 3);
    if (hintTime > 0) hintTime = Math.max(0, hintTime - dt);

    var i;
    for (i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
    }

    for (i = waves.length - 1; i >= 0; i--) {
      var wv = waves[i];
      wv.life -= dt;
      if (wv.life <= 0) { waves.splice(i, 1); continue; }
      var k = 1 - wv.life / wv.dur;
      wv.r = wv.r + (wv.max - wv.r) * Math.min(1, dt * 6);
    }

    for (i = 0; i < drops.length; i++) {
      if (drops[i].born < 1) drops[i].born = Math.min(1, drops[i].born + dt * 5);
    }

    for (i = 0; i < hazards.length; i++) {
      var h = hazards[i];
      if (h.trail) {
        for (var j = h.trail.length - 1; j >= 0; j--) {
          h.trail[j].life -= dt;
          if (h.trail[j].life <= 0) h.trail.splice(j, 1);
        }
      }
    }

    if (kb.on) {
      // Прицел ходит по фигуре Лиссажу: путь не повторяется коротким
      // циклом, поэтому клавиатурой можно достать любую точку поля.
      kb.t += dt;
      kb.x = FIELD_W * (0.5 + 0.42 * Math.sin(kb.t * 0.9));
      kb.y = FIELD_H * (0.5 + 0.42 * Math.sin(kb.t * 0.61 + 1.1));
    }

    moveMotes(dt, core ? core.time : 0);

    if (state !== 'play') return;
    moveHazards(dt);
    if (growing) growDrop(dt);
  }

  /* --- Отрисовка: помощники ---------------------------------------------- */

  function sx(fx) { return ox + fx * scale; }
  function sy(fy) { return oy + fy * scale; }

  function pal() {
    var h = waterHue(level);
    return {
      h: h,
      bgTop: hsla(h, 45, 9, 1),
      bgBot: hsla(h, 55, 4, 1),
      field: hsla(h, 42, 11, 1),
      glow: hsla(h, 80, 55, 0.07),
      edge: hsla(h, 70, 62, 0.22),
      grid: hsla(h, 70, 62, 0.1),
      accent: hsla(h, 78, 68, 1),
      dim: hsla(h, 35, 80, 0.62),
      wall: hsla(h + 12, 22, 62, 0.88),
      wallGlow: hsla(h + 12, 30, 70, 0.25)
    };
  }

  function roundRect(cx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    cx.beginPath();
    cx.moveTo(x + rr, y);
    cx.arcTo(x + w, y, x + w, y + h, rr);
    cx.arcTo(x + w, y + h, x, y + h, rr);
    cx.arcTo(x, y + h, x, y, rr);
    cx.arcTo(x, y, x + w, y, rr);
    cx.closePath();
  }

  function text(cx, str, x, y, size, color, align, weight) {
    cx.font = (weight || 600) + ' ' + Math.round(size * us) + 'px Rubik, sans-serif';
    cx.fillStyle = color;
    cx.textAlign = align || 'center';
    cx.textBaseline = 'middle';
    cx.fillText(str, x, y);
  }

  function button(cx, label, sub, x, y, w, h, color, action, disabled) {
    var bw = w * us, bh = h * us;
    var bx = x - bw / 2, by = y - bh / 2;

    cx.save();
    if (!disabled) { cx.shadowColor = color; cx.shadowBlur = 18 * us; }
    cx.globalAlpha = disabled ? 0.35 : 1;
    cx.fillStyle = color;
    roundRect(cx, bx, by, bw, bh, 14 * us);
    cx.fill();
    cx.restore();

    var ty = sub ? y - 8 * us : y;
    text(cx, label, x, ty, 17, disabled ? 'rgba(255,255,255,0.5)' : '#06131a', 'center', 800);
    if (sub) text(cx, sub, x, y + 13 * us, 11, 'rgba(6,19,26,0.62)', 'center', 700);

    if (!disabled) buttons.push({ x: bx, y: by, w: bw, h: bh, action: action });
  }

  /* --- Отрисовка: поле ---------------------------------------------------- */

  function drawField(cx, p, t) {
    var fw = FIELD_W * scale, fh = FIELD_H * scale;

    cx.save();
    cx.shadowColor = hsla(p.h, 80, 55, 0.2);
    cx.shadowBlur = 26 * us;
    cx.fillStyle = p.field;
    roundRect(cx, ox, oy, fw, fh, 18 * us);
    cx.fill();
    cx.restore();

    cx.save();
    roundRect(cx, ox, oy, fw, fh, 18 * us);
    cx.clip();

    var g = cx.createRadialGradient(ox + fw / 2, oy + fh / 2, 0,
                                    ox + fw / 2, oy + fh / 2, fw * 0.8);
    g.addColorStop(0, p.glow);
    g.addColorStop(1, hsla(p.h, 80, 55, 0));
    cx.fillStyle = g;
    cx.fillRect(ox, oy, fw, fh);

    // Каустика: медленные светлые дуги, как отблески на дне бассейна.
    // Без них поле — плоская подложка; с ними оно становится поверхностью,
    // и капли перестают читаться как кружки на бумаге.
    cx.strokeStyle = hsla(p.h, 90, 74, 0.035);
    for (var c = 0; c < 3; c++) {
      var cy = FIELD_H * (0.24 + c * 0.28) + Math.sin(t * 0.26 + c * 1.7) * 30;
      var cw = FIELD_W * (0.52 + 0.12 * Math.sin(t * 0.19 + c));
      // Толстая и почти прозрачная линия читается как размытое пятно
      // света, тонкая — как начерченный эллипс. Блюра на канвасе нет,
      // поэтому мягкость делается толщиной.
      cx.lineWidth = (16 + c * 6) * scale;
      cx.beginPath();
      cx.ellipse(sx(FIELD_W / 2 + Math.sin(t * 0.15 + c * 2.1) * 70), sy(cy),
        cw * scale, (26 + c * 10) * scale, 0, 0, TAU);
      cx.stroke();
    }

    // Пузырьки, поднимающиеся со дна.
    for (var mi = 0; mi < motes.length; mi++) {
      var m = motes[mi];
      cx.fillStyle = hsla(p.h, 80, 88, 0.09);
      cx.beginPath();
      cx.arc(sx(m.x), sy(m.y), m.r * scale, 0, TAU);
      cx.fill();
      cx.strokeStyle = hsla(p.h, 90, 92, 0.16);
      cx.lineWidth = Math.max(0.6, 0.9 * us);
      cx.stroke();
    }

    // Точечная сетка. Без неё поле читается как пустота: глазу не за что
    // зацепиться, и размер растущей капли не с чем сравнить. Точки слегка
    // ходят волной — сетка сама становится частью поверхности.
    var step = FIELD_W / 8;
    cx.fillStyle = p.grid;
    for (var gx = step / 2; gx < FIELD_W; gx += step) {
      for (var gy = step / 2; gy < FIELD_H; gy += step) {
        var wob = Math.sin(t * 0.9 + gx * 0.03 + gy * 0.02);
        cx.beginPath();
        cx.arc(sx(gx + wob * 2.2), sy(gy + Math.cos(t * 0.7 + gx * 0.02) * 1.6),
          Math.max(0.8, (1.3 + wob * 0.25) * us), 0, TAU);
        cx.fill();
      }
    }
    cx.restore();

    cx.strokeStyle = p.edge;
    cx.lineWidth = Math.max(1, 1.5 * us);
    roundRect(cx, ox, oy, fw, fh, 18 * us);
    cx.stroke();
  }

  function drawWalls(cx, p) {
    cx.save();
    cx.lineCap = 'round';
    cx.shadowColor = p.wallGlow;
    cx.shadowBlur = 10 * us;
    cx.strokeStyle = p.wall;
    cx.lineWidth = WALL_HALF * 2 * scale;
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i];
      cx.beginPath();
      cx.moveTo(sx(w.x1), sy(w.y1));
      cx.lineTo(sx(w.x2), sy(w.y2));
      cx.stroke();
    }
    cx.restore();
  }

  function drawPearls(cx, time) {
    for (var i = 0; i < pearls.length; i++) {
      var p = pearls[i];
      if (p.taken) continue;
      var x = sx(p.x), y = sy(p.y);
      var k = 1 + Math.sin(time * 3 + p.ph) * 0.16;
      cx.save();
      cx.shadowColor = 'rgba(255,255,255,0.9)';
      cx.shadowBlur = 12 * us;
      cx.fillStyle = '#ffffff';
      cx.beginPath();
      cx.arc(x, y, PEARL_R * scale * k * 0.62, 0, TAU);
      cx.fill();
      cx.restore();
      cx.strokeStyle = 'rgba(255,255,255,0.6)';
      cx.lineWidth = Math.max(1, 1.1 * us);
      cx.beginPath();
      cx.arc(x, y, PEARL_R * scale * k, 0, TAU);
      cx.stroke();
    }
  }

  function drawWaves(cx, p) {
    for (var i = 0; i < waves.length; i++) {
      var w = waves[i];
      var a = w.life / w.dur;
      cx.strokeStyle = hsla(p.h, 90, 78, a * 0.5);
      cx.lineWidth = Math.max(1, 2 * us * a);
      cx.beginPath();
      cx.arc(sx(w.x), sy(w.y), w.r * scale, 0, TAU);
      cx.stroke();
    }
  }

  /* Перемычки между соприкоснувшимися каплями.
     Это главное, что превращает набор кругов в жидкость: две капли,
     между которыми есть вогнутая шейка, мозг читает как слившиеся, а два
     касающихся круга — как два круга. Считается геометрией, без фильтров
     канваса: ctx.filter не работает в старых Android WebView, а ВК крутит
     игры именно там. */
  function drawBridges(cx, col) {
    var GAP = 22;
    for (var i = 0; i < drops.length; i++) {
      for (var j = i + 1; j < drops.length; j++) {
        var a = drops[i], b = drops[j];
        var d = dist(a.x, a.y, b.x, b.y);
        var touch = a.r + b.r;
        if (d > touch + GAP || d < 1) continue;

        // k = 1 вплотную, 0 на пределе видимости перемычки.
        var k = clamp(1 - (d - touch) / GAP, 0, 1);
        if (k <= 0.02) continue;
        var ang = Math.atan2(b.y - a.y, b.x - a.x);
        var sp = 0.5 * k;
        var waist = Math.min(a.r, b.r) * 0.42 * k;

        var ax1 = a.x + Math.cos(ang + sp) * a.r, ay1 = a.y + Math.sin(ang + sp) * a.r;
        var ax2 = a.x + Math.cos(ang - sp) * a.r, ay2 = a.y + Math.sin(ang - sp) * a.r;
        var bx1 = b.x + Math.cos(ang + Math.PI - sp) * b.r, by1 = b.y + Math.sin(ang + Math.PI - sp) * b.r;
        var bx2 = b.x + Math.cos(ang + Math.PI + sp) * b.r, by2 = b.y + Math.sin(ang + Math.PI + sp) * b.r;

        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var px = -Math.sin(ang), py = Math.cos(ang);

        cx.fillStyle = col.mid;
        cx.beginPath();
        cx.moveTo(sx(ax1), sy(ay1));
        cx.quadraticCurveTo(sx(mx + px * waist), sy(my + py * waist), sx(bx1), sy(by1));
        cx.lineTo(sx(bx2), sy(by2));
        cx.quadraticCurveTo(sx(mx - px * waist), sy(my - py * waist), sx(ax2), sy(ay2));
        cx.closePath();
        cx.fill();

        // Край шейки повторяет мениск капли: тёмная тень снаружи,
        // светлый ободок внутри. Без этого шейка выглядит наклейкой.
        var edge = function (w, style) {
          cx.strokeStyle = style;
          cx.lineWidth = Math.max(1, w * us);
          cx.beginPath();
          cx.moveTo(sx(ax1), sy(ay1));
          cx.quadraticCurveTo(sx(mx + px * waist), sy(my + py * waist), sx(bx1), sy(by1));
          cx.stroke();
          cx.beginPath();
          cx.moveTo(sx(ax2), sy(ay2));
          cx.quadraticCurveTo(sx(mx - px * waist), sy(my - py * waist), sx(bx2), sy(by2));
          cx.stroke();
        };
        edge(2.6, 'rgba(0,0,0,0.3)');
        edge(1.4, col.rim);
      }
    }
  }

  function drawDrop(cx, d, col) {
    var r = d.r * scale;
    // Застывшая капля «садится» с лёгким перелётом: движение подтверждает
    // игроку, что тап засчитан, быстрее любой надписи.
    if (d.born < 1) r *= 1 + Math.sin(d.born * Math.PI) * 0.06;
    var x = sx(d.x), y = sy(d.y);

    var g = cx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
    g.addColorStop(0, col.core);
    g.addColorStop(0.45, col.mid);
    g.addColorStop(1, col.edge);

    cx.save();
    cx.shadowColor = col.glow;
    cx.shadowBlur = 14 * us;
    cx.fillStyle = g;
    cx.beginPath();
    cx.arc(x, y, r, 0, TAU);
    cx.fill();
    cx.restore();

    // Мениск: тёмная тень снаружи и светлый ободок внутри. Так выглядит
    // поверхностное натяжение, и без него капля остаётся плоским пятном.
    cx.strokeStyle = 'rgba(0,0,0,0.3)';
    cx.lineWidth = Math.max(1, 2.6 * us);
    cx.beginPath();
    cx.arc(x, y, r + cx.lineWidth * 0.35, 0, TAU);
    cx.stroke();

    cx.strokeStyle = col.rim;
    cx.lineWidth = Math.max(1, 1.4 * us);
    cx.beginPath();
    cx.arc(x, y, Math.max(1, r - cx.lineWidth / 2), 0, TAU);
    cx.stroke();

    // Блик сверху-слева: одна дуга, но именно она задаёт объём.
    if (r > 10 * us) {
      cx.strokeStyle = 'rgba(255,255,255,0.55)';
      cx.lineWidth = Math.max(1, r * 0.09);
      cx.beginPath();
      cx.arc(x, y, r * 0.76, Math.PI * 1.03, Math.PI * 1.42);
      cx.stroke();
    }
  }

  function drawGrowing(cx, g, col, time) {
    var r = g.r * scale;
    var x = sx(g.x), y = sy(g.y);

    var grad = cx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, col.core);
    grad.addColorStop(1, col.mid);

    cx.save();
    cx.shadowColor = col.glow;
    cx.shadowBlur = 24 * us;
    cx.fillStyle = grad;
    cx.beginPath();
    cx.arc(x, y, r, 0, TAU);
    cx.fill();
    cx.restore();

    // Пульсирующее кольцо: сообщает «капля ещё живая, останови меня».
    var pulse = 1 + Math.sin(time * 12) * 0.04;
    cx.strokeStyle = g.near > 0 ? '#ffffff' : 'rgba(255,255,255,0.75)';
    cx.lineWidth = Math.max(1.5, (g.near > 0 ? 3.2 : 2) * us);
    cx.beginPath();
    cx.arc(x, y, r * pulse + 3 * us, 0, TAU);
    cx.stroke();
  }

  /* --- Отрисовка: угли ----------------------------------------------------
     Тёплый — единственный цвет с зафиксированным значением. Он не зависит
     ни от глубины, ни от скина, ни от типа угля. */

  function ember(cx, x, y, r, pulse, dim) {
    cx.save();
    cx.shadowColor = EMBER_GLOW;
    cx.shadowBlur = (dim ? 8 : 18) * us;
    var g = cx.createRadialGradient(x, y, 0, x, y, r * 1.6 * pulse);
    g.addColorStop(0, dim ? EMBER_DIM : EMBER_CORE);
    g.addColorStop(0.4, dim ? 'rgba(255,150,80,0.35)' : EMBER_MID);
    g.addColorStop(1, 'rgba(255,107,53,0)');
    cx.fillStyle = g;
    cx.beginPath();
    cx.arc(x, y, r * 1.6 * pulse, 0, TAU);
    cx.fill();
    cx.restore();

    cx.fillStyle = dim ? 'rgba(255,180,120,0.5)' : EMBER_CORE;
    cx.beginPath();
    cx.arc(x, y, r * 0.5, 0, TAU);
    cx.fill();
  }

  function drawHazard(cx, h, time) {
    var x = sx(h.x), y = sy(h.y);
    var pulse = 1 + Math.sin(time * 6 + h.ph) * 0.12;

    if (h.type === 'pend') {
      // Тусклая орбита: траектория видна заранее, маятник проходят
      // головой, а не реакцией.
      cx.strokeStyle = 'rgba(255,150,80,0.16)';
      cx.lineWidth = Math.max(1, 1.2 * us);
      cx.beginPath();
      cx.arc(sx(h.cx), sy(h.cy), h.orbit * scale, 0, TAU);
      cx.stroke();
      cx.fillStyle = 'rgba(255,150,80,0.25)';
      cx.beginPath();
      cx.arc(sx(h.cx), sy(h.cy), 2.5 * us, 0, TAU);
      cx.fill();
      ember(cx, x, y, h.r * scale, pulse, false);
      return;
    }

    if (h.type === 'pulsar') {
      // Полный след опасной зоны показан всегда: игрок должен видеть,
      // куда пульсар дотянется на вдохе, и решать осознанно.
      cx.strokeStyle = 'rgba(255,150,80,0.18)';
      cx.lineWidth = Math.max(1, 1.2 * us);
      cx.beginPath();
      cx.arc(x, y, h.rMax * scale, 0, TAU);
      cx.stroke();

      cx.save();
      cx.shadowColor = EMBER_GLOW;
      cx.shadowBlur = 20 * us;
      var g = cx.createRadialGradient(x, y, 0, x, y, h.r * scale);
      g.addColorStop(0, EMBER_CORE);
      g.addColorStop(0.55, EMBER_MID);
      g.addColorStop(1, 'rgba(255,107,53,0.35)');
      cx.fillStyle = g;
      cx.beginPath();
      cx.arc(x, y, h.r * scale, 0, TAU);
      cx.fill();
      cx.restore();
      return;
    }

    if (h.type === 'sleep') {
      if (h.st === 'sleep') {
        ember(cx, x, y, h.r * scale, 1, true);
        return;
      }
      if (h.st === 'waking') {
        // Кольцо схлопывается к углю: видимый отсчёт форы.
        var k = h.wake / SLEEP_DELAY;
        cx.strokeStyle = 'rgba(255,200,120,' + (0.8 * k).toFixed(2) + ')';
        cx.lineWidth = Math.max(1.5, 2 * us);
        cx.beginPath();
        cx.arc(x, y, (h.r + 26 * k) * scale, 0, TAU);
        cx.stroke();
      }
      ember(cx, x, y, h.r * scale, pulse, false);
      return;
    }

    if (h.type === 'comet' && h.trail) {
      for (var i = 0; i < h.trail.length; i++) {
        var t = h.trail[i];
        var a = t.life / 0.32;
        cx.fillStyle = 'rgba(255,182,72,' + (a * 0.5).toFixed(3) + ')';
        cx.beginPath();
        cx.arc(sx(t.x), sy(t.y), h.r * scale * 0.55 * a, 0, TAU);
        cx.fill();
      }
    }

    ember(cx, x, y, h.r * scale, pulse, false);
  }

  function drawParts(cx, p) {
    for (var i = 0; i < parts.length; i++) {
      var q = parts[i];
      var a = clamp(q.life / q.max, 0, 1);
      cx.fillStyle = q.warm
        ? 'rgba(255,182,72,' + a.toFixed(3) + ')'
        : hsla(p.h, 90, 80, a);
      cx.beginPath();
      cx.arc(sx(q.x), sy(q.y), q.r * scale * a, 0, TAU);
      cx.fill();
    }
  }

  function drawAim(cx, time) {
    var x = sx(kb.x), y = sy(kb.y);
    var r = 13 * us + Math.sin(time * 5) * 2 * us;
    cx.strokeStyle = 'rgba(255,255,255,0.8)';
    cx.lineWidth = Math.max(1.2, 1.6 * us);
    cx.beginPath();
    cx.arc(x, y, r, 0, TAU);
    cx.stroke();
    cx.beginPath();
    cx.moveTo(x - r - 5 * us, y); cx.lineTo(x - r + 3 * us, y);
    cx.moveTo(x + r - 3 * us, y); cx.lineTo(x + r + 5 * us, y);
    cx.moveTo(x, y - r - 5 * us); cx.lineTo(x, y - r + 3 * us);
    cx.moveTo(x, y + r - 3 * us); cx.lineTo(x, y + r + 5 * us);
    cx.stroke();
  }

  /* Кольцо «поставь сюда» на самой первой капле в жизни игрока.
     Опасность первых секунд не в сложности, а в том, что человек не
     поймёт, что от него хотят, и решит, что игра сломана. */
  function drawFirstHint(cx, time) {
    var x = sx(FIELD_W * 0.5), y = sy(FIELD_H * 0.32);
    var r = (26 + Math.sin(time * 3) * 5) * scale;
    cx.strokeStyle = 'rgba(255,255,255,0.55)';
    cx.lineWidth = Math.max(1.5, 2 * us);
    cx.beginPath();
    cx.arc(x, y, r, 0, TAU);
    cx.stroke();
    text(cx, T.t('tapHere'), x, y + r + 18 * us, 12, 'rgba(255,255,255,0.6)', 'center', 700);
  }

  /* --- Отрисовка: интерфейс ----------------------------------------------- */

  function skinColorsOf(idx, lv) {
    var sk = SKINS[idx] || SKINS[0];
    var hue = sk.adaptive ? waterHue(lv) : sk.hue;
    return {
      hue: hue,
      extra: !!sk.extra,
      core: hsla(hue, 100, 96, 1),
      mid: hsla(hue, 72, 66, 1),
      edge: hsla(hue, 70, 42, 0.75),
      glow: hsla(hue, 85, 60, sk.extra ? 0.75 : 0.5),
      rim: hsla(hue, 100, 92, 0.72)
    };
  }

  function drawHud(cx, p) {
    var fw = FIELD_W * scale;

    text(cx, String(score), W / 2, 24 * us, 30, '#ffffff', 'center', 800);
    text(cx, T.t('level') + ' ' + level, ox, 24 * us, 13, p.dim, 'left', 700);

    // Жизни каплями, а не сердечками: символ должен совпадать с тем,
    // чем играешь, иначе игрок ищет связь между иконкой и механикой.
    for (var i = 0; i < livesMax(); i++) {
      if (i >= Math.max(startLives(), lives)) break;
      var x = ox + fw - (i * 16 + 7) * us;
      cx.fillStyle = i < lives ? p.accent : hsla(p.h, 60, 60, 0.18);
      cx.beginPath();
      cx.arc(x, 24 * us, 5.5 * us, 0, TAU);
      cx.fill();
    }

    if (runCoins > 0) text(cx, '◈ ' + runCoins, ox, 45 * us, 12, 'rgba(255,255,255,0.6)', 'left', 700);

    // Множитель появляется только когда он есть: пустая строка в
    // интерфейсе стоит внимания и ничего не сообщает.
    var m = multiplier();
    if (m > 1.001) {
      var mp = 1 + Math.min(streak, 10) * 0.012;
      text(cx, '×' + m.toFixed(1), W / 2, 46 * us, 14 * mp, p.accent, 'center', 800);
    }

    var bw = fw, bh = 7 * us, by = oy - 13 * us;
    cx.fillStyle = hsla(p.h, 60, 60, 0.14);
    roundRect(cx, ox, by, bw, bh, bh / 2);
    cx.fill();

    var k = clamp(filled / target, 0, 1);
    if (k > 0) {
      cx.save();
      cx.shadowColor = hsla(p.h, 90, 70, 0.7);
      cx.shadowBlur = 10 * us;
      cx.fillStyle = k >= 1 ? '#ffffff' : p.accent;
      roundRect(cx, ox, by, Math.max(bh, bw * k), bh, bh / 2);
      cx.fill();
      cx.restore();
    }
    text(cx, Math.round(k * 100) + '%', ox + bw, 45 * us, 12,
      k >= 1 ? '#ffffff' : p.dim, 'right', 700);
  }

  function overlay(cx, p, alpha) {
    cx.fillStyle = hsla(p.h, 55, 4, alpha);
    cx.fillRect(0, 0, W, H);
  }

  function drawMenu(cx, p) {
    overlay(cx, p, 0.8);
    var mid = W / 2;
    var top = H * 0.24;

    text(cx, T.t('title'), mid, top, 50, '#ffffff', 'center', 800);
    text(cx, T.t('hint'), mid, top + 40 * us, 13, p.dim, 'center', 500);
    text(cx, T.t('warn'), mid, top + 60 * us, 13, EMBER_MID, 'center', 600);

    text(cx, T.t('best') + ' ' + save.best, mid - 62 * us, top + 96 * us, 14, p.accent, 'center', 700);
    text(cx, T.t('deepest') + ' ' + save.bestLevel, mid + 62 * us, top + 96 * us, 14, p.accent, 'center', 700);
    text(cx, '◈ ' + save.coins, mid, top + 118 * us, 13, 'rgba(255,255,255,0.55)', 'center', 700);

    button(cx, T.t('play'), null, mid, H * 0.66, 210, 60, p.accent, startRun);
    button(cx, T.t('shop'), null, mid, H * 0.66 + 78 * us, 170, 46,
      hsla(p.h, 60, 62, 0.35), function () { S.click(); state = 'shop'; });

    var label = T.t('sound') + ': ' + (save.sound ? T.t('on') : T.t('off'));
    button(cx, label, null, mid, H * 0.66 + 140 * us, 140, 38, hsla(p.h, 40, 60, 0.22),
      function () {
        save.sound = save.sound ? 0 : 1;
        S.setEnabled(!!save.sound);
        persist();
        S.click();
      });
  }

  function drawDead(cx, p) {
    overlay(cx, p, 0.82);
    var mid = W / 2;
    var top = H * 0.24;

    text(cx, T.t('gameOver'), mid, top, 24, 'rgba(255,255,255,0.85)', 'center', 700);
    text(cx, String(score), mid, top + 50 * us, 54, '#ffffff', 'center', 800);
    text(cx, newBest ? T.t('newBest') : T.t('best') + ' ' + save.best,
      mid, top + 90 * us, 14, newBest ? p.accent : p.dim, 'center', 700);
    text(cx, T.t('level') + ' ' + level + (runCoins > 0 ? '   ◈ ' + runCoins : ''),
      mid, top + 112 * us, 13, 'rgba(255,255,255,0.5)', 'center', 600);

    // Одна rewarded-кнопка и только пока площадка подтверждает наличие
    // ролика: без проверки игрок жмёт, ждёт и получает «награда не
    // засчитана». rewardedReady приходит от адаптера площадки.
    var y = top + 168 * us;
    if (P.available && P.rewardedReady && !continueUsed) {
      button(cx, '▶ ' + T.t('continueAd'), T.t('forAd'), mid, y, 250, 58, '#ffd166', doContinue);
      y += 74 * us;
      /* Экран рисуется каждый кадр, поэтому предложение засчитываем один раз
         за смерть. Без этой отметки видны только нажатия, а сколько игроков
         кнопку вообще увидели — нет, и конверсия в показ не считается. */
      if (!adOffer) {
        adOffer = true;
        A.event('ad_offer', { s: 'continue', dev: P.deviceType || '?' });
      }
    }
    button(cx, T.t('again'), null, mid, y, 200, 52, p.accent, startRun);
    button(cx, T.t('shop'), null, mid, y + 64 * us, 150, 42,
      hsla(p.h, 60, 62, 0.35), function () { S.click(); state = 'shop'; });
  }

  function shopRow(cx, p, y, rowW, active) {
    var bx = W / 2 - rowW / 2, rh = 52 * us;
    cx.fillStyle = active ? hsla(p.h, 60, 60, 0.18) : hsla(p.h, 40, 50, 0.08);
    roundRect(cx, bx, y - rh / 2, rowW, rh, 12 * us);
    cx.fill();
    if (active) {
      cx.strokeStyle = p.accent;
      cx.lineWidth = Math.max(1, 1.4 * us);
      roundRect(cx, bx, y - rh / 2, rowW, rh, 12 * us);
      cx.stroke();
    }
    return { bx: bx, rh: rh };
  }

  /* Точки уровня прокачки. Полоска процентов тут читалась бы хуже:
     уровней два-три, и глазу нужно видеть, сколько осталось, а не долю. */
  function drawPips(cx, p, x, y, have, max) {
    for (var i = 0; i < max; i++) {
      cx.fillStyle = i < have ? p.accent : hsla(p.h, 50, 60, 0.22);
      cx.beginPath();
      cx.arc(x + i * 11 * us, y, 3.6 * us, 0, TAU);
      cx.fill();
    }
  }

  function drawShop(cx, p) {
    overlay(cx, p, 0.92);
    var mid = W / 2;
    var rowW = Math.min(W - 36 * us, 330 * us);

    text(cx, T.t('shop'), mid, H * 0.09, 26, '#ffffff', 'center', 800);
    text(cx, '◈ ' + save.coins, mid, H * 0.09 + 28 * us, 15, p.accent, 'center', 700);

    // Вкладки
    var tabY = H * 0.09 + 62 * us;
    var tw = 118, th = 34;
    button(cx, T.t('tabUp'), null, mid - 62 * us, tabY, tw, th,
      shopTab === 'up' ? p.accent : hsla(p.h, 50, 55, 0.22),
      function () { S.click(); shopTab = 'up'; });
    button(cx, T.t('tabSkin'), null, mid + 62 * us, tabY, tw, th,
      shopTab === 'skin' ? p.accent : hsla(p.h, 50, 55, 0.22),
      function () { S.click(); shopTab = 'skin'; });

    var top = tabY + 52 * us;
    var i;

    if (shopTab === 'up') {
      for (i = 0; i < UPGRADES.length; i++) {
        (function (idx) {
          var u = UPGRADES[idx];
          var have = upLvl(u.key);
          var full = have >= u.max;
          var cost = upCost(u);
          var can = !full && save.coins >= cost;
          var y = top + idx * 60 * us;
          var box = shopRow(cx, p, y, rowW, full);

          text(cx, T.dict === DICT.ru ? u.ru : u.en, box.bx + 16 * us, y - 10 * us,
            15, '#ffffff', 'left', 700);
          text(cx, T.dict === DICT.ru ? u.ruSub : u.enSub, box.bx + 16 * us, y + 9 * us,
            11, p.dim, 'left', 500);
          drawPips(cx, p, box.bx + rowW - 76 * us, y - 10 * us, have, u.max);
          text(cx, full ? T.t('maxed') : '◈ ' + cost,
            box.bx + rowW - 16 * us, y + 9 * us, 12,
            full ? p.dim : (can ? '#ffffff' : 'rgba(255,255,255,0.4)'), 'right', 700);

          if (full) return;
          buttons.push({
            x: box.bx, y: y - box.rh / 2, w: rowW, h: box.rh,
            action: function () {
              if (save.coins < cost) {
                S.tone({ freq: 160, dur: 0.12, type: 'square', gain: 0.2 });
                return;
              }
              save.coins -= cost;
              save.up[u.key] = have + 1;
              S.reward();
              persist();
            }
          });
        })(i);
      }
    } else {
      for (i = 0; i < SKINS.length; i++) {
        (function (idx) {
          var sk = SKINS[idx];
          var owned = !!save.owned[idx];
          var active = save.skin === idx;
          var y = top + idx * 60 * us;
          var box = shopRow(cx, p, y, rowW, active);

          var col = skinColorsOf(idx, level);
          var px = box.bx + 28 * us;
          var g = cx.createRadialGradient(px - 5 * us, y - 6 * us, 2 * us, px, y, 15 * us);
          g.addColorStop(0, col.core);
          g.addColorStop(0.45, col.mid);
          g.addColorStop(1, col.edge);
          cx.save();
          cx.shadowColor = col.glow;
          cx.shadowBlur = 12 * us;
          cx.fillStyle = g;
          cx.beginPath();
          cx.arc(px, y, 15 * us, 0, TAU);
          cx.fill();
          cx.restore();

          text(cx, T.dict === DICT.ru ? sk.ru : sk.en, box.bx + 54 * us, y - 9 * us,
            15, '#ffffff', 'left', 700);
          text(cx, active ? T.t('equipped') : (owned ? T.t('equip') : '◈ ' + sk.cost),
            box.bx + 54 * us, y + 10 * us, 12,
            owned ? p.dim : 'rgba(255,255,255,0.45)', 'left', 600);

          if (active) return;
          buttons.push({
            x: box.bx, y: y - box.rh / 2, w: rowW, h: box.rh,
            action: function () {
              if (save.owned[idx]) {
                save.skin = idx;
                S.click();
              } else if (save.coins >= sk.cost) {
                save.coins -= sk.cost;
                save.owned[idx] = 1;
                save.skin = idx;
                S.reward();
              } else {
                S.tone({ freq: 160, dur: 0.12, type: 'square', gain: 0.2 });
                return;
              }
              persist();
            }
          });
        })(i);
      }
    }

    button(cx, T.t('back'), null, mid, H - 58 * us, 180, 46, p.accent,
      function () { S.click(); state = lives <= 0 && save.runs > 0 ? 'dead' : 'menu'; });
  }


  /* --- Кадр ---------------------------------------------------------------- */

  function render(cx) {
    buttons.length = 0;
    cx.setTransform(core.dpr, 0, 0, core.dpr, 0, 0);
    var p = pal();

    var g = cx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, p.bgTop);
    g.addColorStop(1, p.bgBot);
    cx.fillStyle = g;
    cx.fillRect(0, 0, W, H);

    if (state === 'boot') {
      text(cx, T.t('loading'), W / 2, H / 2, 18, 'rgba(255,255,255,0.7)');
      return;
    }

    var t = core.time;
    var col = skinColors(level);
    var jx = shake ? rnd(-1, 1) * shake * 7 * us : 0;
    var jy = shake ? rnd(-1, 1) * shake * 7 * us : 0;

    cx.save();
    cx.translate(jx, jy);
    drawField(cx, p, t);

    cx.save();
    roundRect(cx, ox, oy, FIELD_W * scale, FIELD_H * scale, 18 * us);
    cx.clip();

    drawWaves(cx, p);
    drawWalls(cx, p);
    drawPearls(cx, t);
    var i;
    for (i = 0; i < drops.length; i++) drawDrop(cx, drops[i], col);
    // Перемычки поверх капель: их собственный тёмный мениск иначе
    // затирает шейку, и слияние снова распадается на два круга.
    drawBridges(cx, col);
    if (growing) drawGrowing(cx, growing, col, t);
    for (i = 0; i < hazards.length; i++) drawHazard(cx, hazards[i], t);
    drawParts(cx, p);

    if (state === 'play' && kb.on && !growing) drawAim(cx, t);
    if (state === 'play' && placedEver === 0 && !growing) drawFirstHint(cx, t);
    cx.restore();

    drawHud(cx, p);
    cx.restore();

    // Подсказка под полем: одна строка, ровно тогда, когда нужна.
    if (state === 'play' && growing && frozeEver === 0) {
      text(cx, T.t('tapStop'), W / 2, oy + FIELD_H * scale + 18 * us, 13,
        'rgba(255,255,255,0.7)', 'center', 700);
    } else if (hintTime > 0) {
      var a = Math.min(1, hintTime / 0.4);
      text(cx, hintText, W / 2, oy + FIELD_H * scale + 18 * us, 13,
        'rgba(255,255,255,' + (a * 0.8).toFixed(2) + ')', 'center', 700);
    }

    if (flash > 0) {
      cx.fillStyle = hsla(p.h, 90, 70, flash * 0.26);
      cx.fillRect(0, 0, W, H);
      text(cx, flashText, W / 2, H * 0.5, 22,
        'rgba(255,255,255,' + flash.toFixed(2) + ')', 'center', 800);
    }

    if (state === 'menu') drawMenu(cx, p);
    else if (state === 'dead') drawDead(cx, p);
    else if (state === 'shop') drawShop(cx, p);
  }

  /* --- Ввод ---------------------------------------------------------------- */

  function onPress(x, y) {
    S.unlock();
    S.resume();

    // -1 — нажатие с клавиатуры, координат нет. Первое такое нажатие
    // только включает прицел, чтобы игрок увидел, чем он целится.
    var fromKey = (x < 0 && y < 0);
    if (fromKey && !kb.on && state === 'play') { kb.on = true; kb.t = 0; return; }
    if (!fromKey) kb.on = false;

    if (state === 'boot') return;

    if (state !== 'play') {
      if (fromKey) {
        if (buttons.length) buttons[0].action();
        return;
      }
      for (var i = buttons.length - 1; i >= 0; i--) {
        var b = buttons[i];
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { b.action(); return; }
      }
      return;
    }

    if (growing) { freeze(); return; }
    if (fromKey) { placeAt(kb.x, kb.y); return; }
    placeAt((x - ox) / scale, (y - oy) / scale);
  }

  /* --- Раскладка и запуск --------------------------------------------------- */

  function layout(w, h) {
    W = w;
    H = h;
    us = clamp(Math.min(W / 420, H / 760), 0.72, 1.9);

    // Сверху резервируем полосу под счёт и шкалу, снизу — строку
    // подсказки. Поле центрируется в остатке.
    var hud = 68 * us;
    var foot = 30 * us;
    scale = Math.min((W - 20 * us) / FIELD_W, (H - hud - foot) / FIELD_H);
    ox = (W - FIELD_W * scale) / 2;
    oy = hud + (H - hud - foot - FIELD_H * scale) / 2;
  }

  function waitForFont() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load('800 44px Rubik', '0123456789'),
      document.fonts.load('700 21px Rubik', 'Капля Играть Уровень Скины'),
      document.fonts.load('600 14px Rubik', 'Score Best Play Level Skins')
    ]).catch(function () { /* нет шрифта — рисуем запасным */ });
  }

  function applySave(data) {
    if (!data || typeof data !== 'object') return;
    save.best = data.best || 0;
    save.bestLevel = data.bestLevel || 1;
    save.coins = data.coins || 0;
    save.runs = data.runs || 0;
    save.sound = data.sound === 0 ? 0 : 1;
    save.seen = (data.seen && typeof data.seen === 'object') ? data.seen : {};
    // Скины: индекс и владение проверяем, а не доверяем — сохранение
    // могло прийти от другой версии игры.
    var owned = [1, 0, 0, 0, 0];
    if (data.owned && data.owned.length) {
      for (var i = 0; i < SKINS.length; i++) owned[i] = data.owned[i] ? 1 : 0;
    }
    owned[0] = 1;
    save.owned = owned;
    save.skin = (data.skin >= 0 && data.skin < SKINS.length && owned[data.skin]) ? data.skin : 0;

    // Прокачку тоже не принимаем на веру: уровни клампим по потолку.
    var up = {};
    for (var k = 0; k < UPGRADES.length; k++) {
      var u = UPGRADES[k];
      var v = (data.up && data.up[u.key]) | 0;
      up[u.key] = clamp(v, 0, u.max);
    }
    save.up = up;
  }

  function boot() {
    A.init('kaplya');
    core = new global.Core('game');
    core.onResize = layout;
    core.onUpdate = update;
    core.onRender = render;
    core.onPress = onPress;
    core.onVisibility = function (hidden) {
      if (hidden) P.gameplayStop();
      else if (state === 'play') P.gameplayStart();
    };

    layout(global.innerWidth, global.innerHeight);
    makeMotes();
    core.start();

    P.init()
      .then(function () {
        T.use(P.lang);
        return P.load(SAVE_KEY);
      })
      .then(function (data) {
        applySave(data);
        S.setEnabled(!!save.sound);
        return waitForFont();
      })
      .then(function () {
        // Поле под меню не пустое: угли уже летают, и игрок видит
        // движение до того, как нажмёт «Играть».
        setupLevel(1);
        state = 'menu';
        P.ready();

        P.onBannerClosed = function () { A.event('ad', adInfo('banner', 'closed', 0)); };
        P.onLateAd = onLateReward;
        showBanner('boot');

        P.checkRewarded().then(function (has) {
          A.event('ready', {
            dev: P.deviceType || '?',
            sdk: P.available ? 1 : 0,
            rew: has ? 1 : 0,
            best: save.best,
            blvl: save.bestLevel
          });
          A.flush(false);
        });
      })
      .catch(function (e) {
        console.warn('[kaplya] запуск:', e);
        setupLevel(1);
        state = 'menu';
        P.ready();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, false);
  } else {
    boot();
  }
})(window);
