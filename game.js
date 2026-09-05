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

  /* Картинки. Плёнку и спрайты рисовал не код: переливы мыльного пузыря
     процедурно получаются грязными, а рожица у огонька кодом не рисуется
     вовсе. Игра стартует и без них — пока не загрузятся, рисуем запасными
     фигурами, чтобы медленная сеть не показывала игроку пустой экран. */
  var IMG = { ember: null, pearl: null };
  function loadImage(key, src) {
    var im = new global.Image();
    im.onload = function () { IMG[key] = im; };
    im.src = src;
  }

  var foam = null;

  /* --- Локализация ---------------------------------------------------
     Свой словарь, а не engine/i18n.js: тот занят строками Орбиты и общий
     на все игры. Трогать его нельзя — Орбита на модерации, и правка
     общего движка поедет в её следующую сборку. */

  var DICT = {
    ru: {
      title: 'КАПЛЯ',
      hint: 'Держи — капля растёт. Отпусти — застынет.',
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
      tapStop: 'Отпусти, чтобы остановить',
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

  /* Насколько глубоко капля вдавливается в соседа, в долях меньшего
     радиуса. Ровно столько, чтобы перегородка между ними читалась как
     плоская стенка пены, и не больше: при глубоком вдавливании гроздь
     превращается в кляксу и перестаёт читаться по отдельным каплям. */
  var OVERLAP = 0.36;

  var WALL_HALF = 3.5;     // половина толщины барьера
  /* Жемчужина. Была восьмёрка — на телефоне это точка, которую не
     опознать: игрок видел белое пятнышко и не понимал, что это награда.
     Радиус подбора считается отсюда же, так что она стала не только
     заметнее, но и честнее в попадании. */
  var PEARL_R = 13;
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

  /* Тон стекла, на котором живёт пена. Раньше это была толща воды и тон
     уезжал от бирюзы к багрянцу — под мыльную плёнку такая гамма не
     годится: она спорит с радугой самих пузырей и съедает оранжевый, за
     которым закреплена смерть.

     Теперь стекло уходит от индиго к глубокому фиолету и с каждым уровнем
     темнеет. Прогресс по-прежнему виден до того, как игрок посмотрит на
     цифру, но фон при этом остаётся подложкой, а не участником. */
  function waterHue(lv) { return 248 + Math.min((lv - 1) * 4, 60); }
  function glassDark(lv) { return Math.max(2.5, 7 - Math.min(lv - 1, 10) * 0.45); }

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
  /* У каждого скина своя текстура плёнки. Подкраска общей радуги не
     работала: поверх радужных разводов любой светофильтр читается как
     лёгкий сдвиг оттенка, а не как другой пузырь. Файла нет — скин
     откатывается к подкраске, игра от этого не ломается. */
  var SKINS = [
    { cost: 0,   adaptive: true, film: 'film.jpg',       ru: 'Роса',   en: 'Dew' },
    { cost: 60,  hue: 195, film: 'film-frost.jpg',       ru: 'Иней',   en: 'Frost' },
    { cost: 140, hue: 145, film: 'film-mint.jpg',        ru: 'Мята',   en: 'Mint' },
    { cost: 260, hue: 305, film: 'film-neon.jpg',        ru: 'Неон',   en: 'Neon' },
    { cost: 450, hue: 265, extra: true, film: 'film-plasma.jpg',
      ru: 'Плазма', en: 'Plasma' }
  ];

  /* --- Прокачка --------------------------------------------------------
     Первая редакция ТЗ запрещала покупки, влияющие на сложность: боялись
     скатиться в гринд. Это оказалось неверно — скины дают повод копить,
     но не дают цели, и на второй сессии копить становится незачем.

     Постоянный рост возвращает смысл монетам, поэтому запрет снят. Чтобы
     он не сломал игру, соблюдены два условия: ни одна прокачка не
     отменяет смерть от угля, и все они упираются в потолок за разумное
     число забегов. Прокачка делает игрока увереннее, а не бессмертнее. */
  /* Прокачка двух родов, и цены у них разные не случайно.

     Первые четыре двигают числа: крупнее, быстрее, живучее. Мелкие шаги и
     стоить должны как мелкие шаги — покупаются по дороге, между забегами.

     Следующие четыре меняют способ игры: каждая даёт новое решение, а не
     новую цифру, и покупается один раз навсегда. За такое платят заметно,
     иначе они разойдутся за первый вечер и копить снова станет незачем.
     Отсюда разрыв в разы, а не в проценты: от 320 до 400 против 25–40 за
     первый шаг обычной прокачки. */
  var UPGRADES = [
    { key: 'life', max: 3, cost: [30, 80, 170],
      ru: 'Живучесть', en: 'Vitality',
      ruSub: '+1 жизнь в начале забега', enSub: '+1 starting life' },
    { key: 'size', max: 3, cost: [25, 70, 150],
      ru: 'Натяжение', en: 'Tension',
      ruSub: 'капля вырастает крупнее', enSub: 'drops grow larger' },
    { key: 'calm', max: 3, cost: [30, 85, 175],
      ru: 'Напор', en: 'Surge',
      ruSub: 'капля растёт быстрее', enSub: 'drops grow faster' },
    { key: 'pearl', max: 2, cost: [40, 110],
      ru: 'Чутьё', en: 'Instinct',
      ruSub: 'жемчужина ловится издалека', enSub: 'pearls collect from farther' },

    { key: 'edge', max: 1, cost: [320],
      ru: 'Прилипание', en: 'Cling',
      ruSub: 'капля у стены растёт вдоль неё', enSub: 'drops near walls grow along them' },
    { key: 'spare', max: 1, cost: [400],
      ru: 'Запасная', en: 'Spare',
      ruSub: 'первая потеря за уровень бесплатна', enSub: 'first loss each level is free' },
    { key: 'magnet', max: 1, cost: [260],
      ru: 'Притяжение', en: 'Pull',
      ruSub: 'жемчужины плывут к каплям', enSub: 'pearls drift toward your drops' },
    { key: 'radar', max: 1, cost: [300],
      ru: 'Предчувствие', en: 'Foresight',
      ruSub: 'видно, куда уголь придёт через секунду', enSub: 'shows where embers will be' }
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
    up: { life: 0, size: 0, calm: 0, pearl: 0, edge: 0, spare: 0, magnet: 0, radar: 0 },
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

  /* Площадь пересечения двух кругов. Нужна с тех пор, как капли стали
     вдавливаться друг в друга по-настоящему: сумма площадей начала бы
     считать перекрытие дважды, и заполнение врало бы в пользу игрока. */
  function lensArea(r1, r2, d) {
    if (d >= r1 + r2) return 0;
    if (d <= Math.abs(r1 - r2)) {
      var rm = Math.min(r1, r2);
      return Math.PI * rm * rm;
    }
    var a1 = Math.acos(clamp((d * d + r1 * r1 - r2 * r2) / (2 * d * r1), -1, 1));
    var a2 = Math.acos(clamp((d * d + r2 * r2 - r1 * r1) / (2 * d * r2), -1, 1));
    return r1 * r1 * (a1 - Math.sin(2 * a1) / 2) +
           r2 * r2 * (a2 - Math.sin(2 * a2) / 2);
  }

  /* Занятая площадь: сумма кругов минус попарные пересечения. Там, где
     сошлись три капли, кусочек вычитается дважды — но вдавливание у нас
     ограничено, такие места крошечные, и ошибка меньше десятой процента.
     Точная формула стоила бы разбора всех пересечений дуг, а платить за это
     нечем: игрок видит шкалу, а не бухгалтерию. */
  function unionArea(list) {
    var sum = 0, i, j;
    for (i = 0; i < list.length; i++) sum += Math.PI * list[i].r * list[i].r;
    for (i = 0; i < list.length; i++) {
      for (j = i + 1; j < list.length; j++) {
        sum -= lensArea(list[i].r, list[j].r,
                        dist(list[i].x, list[i].y, list[j].x, list[j].y));
      }
    }
    return sum > 0 ? sum : 0;
  }

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

  /* Скин задаёт оттенок, которым подкрашивается плёнка внутри пузырей.
     Раньше он менял цвет самой капли целиком — но капля теперь сделана из
     радужной текстуры, и красить её сплошным цветом значит выбросить всё,
     ради чего эта текстура нужна. Поэтому скин стал светофильтром: плёнка
     остаётся радужной, но у «Инея» уходит в холод, у «Плазмы» в золото.
     Разница видна, а материал сохраняется. */
  function skinTint(lv) {
    var sk = SKINS[save.skin] || SKINS[0];
    // Своя текстура есть — красить нечего, она уже нужного цвета.
    if (sk.film) return hsla(waterHue(lv), 70, 32, 0.12);
    if (sk.adaptive) return hsla(waterHue(lv), 70, 32, 0.16);
    return hsla(sk.hue, 78, 46, sk.extra ? 0.34 : 0.26);
  }

  /* Зовётся при запуске и при смене скина в лавке. */
  function useSkinFilm() {
    var sk = SKINS[save.skin] || SKINS[0];
    foam.load('assets/' + (sk.film || 'film.jpg'));
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
  function growAcc() { return GROW_ACC; }

  /* Скорость роста. Раньше эта прокачка работала наоборот — замедляла
     разгон, — и при двух тапах в этом был смысл: медленная капля давала
     время среагировать на второй тап. С переходом на удержание смысл
     исчез: игрок и так управляет непрерывно, а медленный рост означает
     только дольше держать палец. Теперь прокачка ускоряет. */
  function growBase() { return GROW_BASE + upLvl('calm') * 9; }
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
    filled = unionArea(drops);
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
    /* «Запасная»: первая потеря на уровне не стоит жизни. Меняет не число,
       а отношение к риску — на свежем уровне можно позволить себе жадность,
       которой без неё не позволишь. */
    if (!(upLvl('spare') && lostThisLevel === 0)) lives--;
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

  /* «Притяжение»: жемчужины медленно плывут к ближайшей застывшей капле.
     Меняет не радиус подбора, а планировку: теперь имеет смысл ставить
     каплю в стороне от жемчужины и ждать, пока та подойдёт сама. */
  function movePearls(dt) {
    if (!upLvl('magnet')) return;
    for (var i = 0; i < pearls.length; i++) {
      var p = pearls[i];
      if (p.taken) continue;
      var best = null, bd = 1e9;
      for (var j = 0; j < drops.length; j++) {
        var d = dist(p.x, p.y, drops[j].x, drops[j].y) - drops[j].r;
        if (d < bd) { bd = d; best = drops[j]; }
      }
      if (!best || bd > 120) continue;
      var dx = best.x - p.x, dy = best.y - p.y;
      var m = Math.sqrt(dx * dx + dy * dy) || 1;
      p.x += dx / m * 26 * dt;
      p.y += dy / m * 26 * dt;
      if (bd < 0) {
        p.taken = 1;
        runCoins += 3;
        save.coins += 3;
        S.tone({ freq: 940, dur: 0.09, type: 'sine', gain: 0.4 });
      }
    }
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
        h.phase += dt * TAU / h.period;
        h.r = h.rMin + (h.rMax - h.rMin) * (0.5 - 0.5 * Math.cos(h.phase));
        /* Звука у пульсара нет. Был глухой удар на вдохе — на девяноста
           герцах он на телефонном динамике превращался в дребезг и звучал
           поломкой, а не предупреждением. Опасную зону и так видно кольцом,
           так что информации мы не теряем. */
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
    g.r += (growBase() + g.r * growAcc()) * dt;
    if (g.near > 0) g.near -= dt;

    var step = Math.floor((g.r - MIN_R) / 12);
    if (step > g.tick) {
      g.tick = step;
      S.tone({ freq: 260 + step * 46, dur: 0.04, type: 'triangle', gain: 0.16 });
    }

    /* Стенка поля останавливает рост. Значит у края всегда безопасно, но
       мелко — честный размен, а не бесплатный угол.

       «Прилипание» этот размен снимает: капля не упирается в стену, а
       отъезжает от неё центром и продолжает расти вдоль. Появляется новая
       цель — края и углы, куда раньше помещалась только мелочь. */
    var wallGap = Math.min(g.x, g.y, FIELD_W - g.x, FIELD_H - g.y);
    if (g.r >= wallGap) {
      if (upLvl('edge')) {
        if (g.x < g.r) g.x = g.r;
        if (g.y < g.r) g.y = g.r;
        if (g.x > FIELD_W - g.r) g.x = FIELD_W - g.r;
        if (g.y > FIELD_H - g.r) g.y = FIELD_H - g.r;
        // Совсем уж узкую щель всё равно не растянуть.
        if (g.r * 2 >= Math.min(FIELD_W, FIELD_H)) { freeze(); return; }
      } else {
        g.r = wallGap;
        freeze();
        return;
      }
    }

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

    /* Соседняя капля — не смерть, а стена. Иначе игра наказывала бы за
       плотную упаковку, то есть за лучшую из возможных игр, и делала бы
       это в конце уровня, когда поле и так тесное.

       Но останавливаемся не в момент касания, а когда капля вдавилась в
       соседа на OVERLAP. Мыльные пузыри так и ведут себя: прижимаются,
       образуя между собой плоскую перегородку. Раньше вдавливание было
       только нарисованным, и картинка обгоняла правила на пятую часть
       радиуса — игрок видел касание угля раньше, чем оно случалось. */
    for (i = 0; i < drops.length; i++) {
      var dr = drops[i];
      var dd = dist(g.x, g.y, dr.x, dr.y);
      var room = OVERLAP * Math.min(g.r, dr.r);
      if (dd < g.r + dr.r - room) {
        g.r = Math.max(MIN_R, dd - dr.r + room);
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
      movePearls(dt);
    }
    if (foam) foam.step(dt);

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

  /* Фон почти чёрный — и это не про настроение, а про правило игры.
     Тёплый цвет означает смерть, и он обязан быть виден мгновенно. Радужная
     плёнка сама по себе яркая и пёстрая; если поднять яркость ещё и у фона,
     оранжевому углю не на чем будет выделиться. Всё, что не пузырь и не
     уголь, живёт в нижней трети яркости. */
  function pal() {
    var h = waterHue(level);
    return {
      h: h,
      bgTop: hsla(h, 46, glassDark(level) + 1.5, 1),
      bgBot: hsla(h + 14, 60, 1.6, 1),
      field: hsla(h, 42, glassDark(level), 1),
      glow: hsla(h, 80, 55, 0.06),
      edge: hsla(h, 70, 70, 0.22),
      grid: hsla(h, 70, 78, 0.09),
      /* Акцент не следует за глубиной: на радужной плёнке цвет, взятый из
         той же гаммы, теряется в ней. Сиреневый белёсый читается на любом
         кадре и не спорит с оранжевым, за которым закреплена смерть. */
      accent: 'hsla(272,90%,82%,1)',
      dim: 'hsla(268,30%,86%,0.6)',
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

  /* Стеклянная поверхность: тёмная основа, плёнка сквозь неё, светлый верх
     и тонкий ободок. Один материал на кнопки, панели и шкалу — интерфейс
     должен быть сделан из того же, из чего пузыри, иначе он выглядит
     приклеенным поверх чужой игры. */
  function glass(cx, bx, by, bw, bh, r, opts) {
    var o = opts || {};
    var film = o.film === undefined ? 0.4 : o.film;

    roundRect(cx, bx, by, bw, bh, r);
    cx.fillStyle = o.base || 'rgba(10,13,34,0.8)';
    cx.fill();

    if (film > 0 && foam) {
      cx.save();
      roundRect(cx, bx, by, bw, bh, r);
      cx.clip();
      foam.sheen(cx, bx, by, bw, bh, film);
      cx.restore();
    }

    // Свет сверху: без него стекло читается как матовая наклейка.
    cx.save();
    roundRect(cx, bx, by, bw, bh, r);
    cx.clip();
    var g = cx.createLinearGradient(0, by, 0, by + bh);
    g.addColorStop(0, 'rgba(255,255,255,0.28)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.04)');
    g.addColorStop(1, 'rgba(0,0,0,0.28)');
    cx.fillStyle = g;
    cx.fillRect(bx, by, bw, bh);
    cx.restore();

    cx.strokeStyle = o.rim || 'rgba(255,255,255,0.7)';
    cx.lineWidth = Math.max(1, (o.rimW || 1.6) * us);
    roundRect(cx, bx, by, bw, bh, r);
    cx.stroke();
  }

  function button(cx, label, sub, x, y, w, h, color, action, disabled) {
    var bw = w * us, bh = h * us;
    var bx = x - bw / 2, by = y - bh / 2;
    var r = bh / 2;

    cx.save();
    if (!disabled) {
      cx.shadowColor = 'rgba(190,150,255,0.5)';
      cx.shadowBlur = 16 * us;
    }
    cx.globalAlpha = disabled ? 0.4 : 1;
    glass(cx, bx, by, bw, bh, r, {
      film: disabled ? 0.12 : 0.45,
      rim: disabled ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.8)'
    });
    cx.restore();

    // Подпись светлая: на радужном стекле тёмный текст тонет в пятнах.
    var ty = sub ? y - 8 * us : y;
    cx.save();
    cx.shadowColor = 'rgba(0,0,0,0.75)';
    cx.shadowBlur = 5 * us;
    text(cx, label, x, ty, 17,
      disabled ? 'rgba(255,255,255,0.45)' : '#ffffff', 'center', 800);
    if (sub) text(cx, sub, x, y + 13 * us, 11, 'rgba(255,255,255,0.72)', 'center', 700);
    cx.restore();

    if (!disabled) buttons.push({ x: bx, y: by, w: bw, h: bh, action: action });
  }

  /* --- Отрисовка: поле ---------------------------------------------------- */

  /* Мир игры — не толща воды, а тёмное мокрое стекло, по которому
     расползается мыльная плёнка. Отсюда и три слоя фона: медленные
     радужные разводы, скользящий по стеклу блик и расфокусированные
     пузырьки в глубине. Всё держится в нижней трети яркости: любой
     светлый фон отнял бы у оранжевого угля его единственное свойство —
     мгновенную заметность. */
  function drawField(cx, p, t) {
    var fw = FIELD_W * scale, fh = FIELD_H * scale;

    cx.save();
    cx.shadowColor = hsla(p.h, 80, 60, 0.18);
    cx.shadowBlur = 26 * us;
    cx.fillStyle = p.field;
    roundRect(cx, ox, oy, fw, fh, 18 * us);
    cx.fill();
    cx.restore();

    cx.save();
    roundRect(cx, ox, oy, fw, fh, 18 * us);
    cx.clip();

    /* Разводы. Три больших мягких пятна из плёночных цветов, каждое со
       своим ходом, — вместе они дышат и никогда не повторяются. Раньше
       здесь была каустика бассейна: дуги света на дне. Под стеклом она
       читалась как чужой рисунок, приклеенный снизу. */
    var BLOOM = [
      { c: '196,110,255', sp: 0.13, ax: 0.30, ay: 0.34, r: 0.62 },
      { c: '80,190,255',  sp: 0.09, ax: 0.62, ay: 0.58, r: 0.55 },
      { c: '255,180,90',  sp: 0.07, ax: 0.44, ay: 0.78, r: 0.40 }
    ];
    for (var b = 0; b < BLOOM.length; b++) {
      var bl = BLOOM[b];
      var bx = ox + fw * (bl.ax + Math.sin(t * bl.sp + b * 2.1) * 0.16);
      var by = oy + fh * (bl.ay + Math.cos(t * bl.sp * 0.8 + b) * 0.12);
      var br = fw * bl.r * (1 + Math.sin(t * bl.sp * 1.7 + b) * 0.12);
      var bg = cx.createRadialGradient(bx, by, 0, bx, by, br);
      bg.addColorStop(0, 'rgba(' + bl.c + ',0.15)');
      bg.addColorStop(0.55, 'rgba(' + bl.c + ',0.05)');
      bg.addColorStop(1, 'rgba(' + bl.c + ',0)');
      cx.fillStyle = bg;
      cx.fillRect(ox, oy, fw, fh);
    }

    /* Блик, ползущий по стеклу. Одна широкая косая полоса, проходящая
       поле примерно за двадцать секунд: движение, которое замечаешь, но
       которое не отвлекает от игры. */
    var sweep = ((t * 0.05) % 1.4) - 0.2;
    var sxp = ox + fw * sweep;
    var sg = cx.createLinearGradient(sxp - fw * 0.3, oy, sxp + fw * 0.3, oy + fh);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.5, 'rgba(220,230,255,0.05)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = sg;
    cx.fillRect(ox, oy, fw, fh);

    /* Пузырьки в глубине — расфокусированные, поэтому без резкого контура:
       мягкая заливка и еле заметный ободок. Они и дают чувство объёма
       позади плёнки, и служат меркой размера для растущей капли. */
    for (var mi = 0; mi < motes.length; mi++) {
      var m = motes[mi];
      var mx = sx(m.x), my = sy(m.y), mr = m.r * scale;
      var mg = cx.createRadialGradient(mx - mr * 0.3, my - mr * 0.35, 0, mx, my, mr);
      mg.addColorStop(0, 'rgba(210,225,255,0.16)');
      mg.addColorStop(0.7, 'rgba(170,190,255,0.05)');
      mg.addColorStop(1, 'rgba(170,190,255,0)');
      cx.fillStyle = mg;
      cx.beginPath();
      cx.arc(mx, my, mr, 0, TAU);
      cx.fill();
      if (mr > 2.4 * us) {
        cx.strokeStyle = 'rgba(220,235,255,0.10)';
        cx.lineWidth = Math.max(0.6, 0.8 * us);
        cx.stroke();
      }
    }

    /* Конденсат: мелкие капли на стекле. Заменил точечную сетку — та была
       чертёжной, а нужна была всего одна её работа: дать глазу мерку, с
       которой он сравнивает размер растущей капли. Капли конденсата делают
       то же самое и принадлежат этому миру. */
    var step = FIELD_W / 7;
    for (var gx = step / 2; gx < FIELD_W; gx += step) {
      for (var gy = step / 2; gy < FIELD_H; gy += step) {
        var wob = Math.sin(t * 0.5 + gx * 0.03 + gy * 0.02);
        var dx0 = sx(gx), dy0 = sy(gy);
        var dr = Math.max(0.9, (1.6 + wob * 0.3) * us);
        cx.fillStyle = p.grid;
        cx.beginPath();
        cx.arc(dx0, dy0, dr, 0, TAU);
        cx.fill();
        cx.fillStyle = 'rgba(255,255,255,0.22)';
        cx.beginPath();
        cx.arc(dx0 - dr * 0.32, dy0 - dr * 0.36, dr * 0.34, 0, TAU);
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
      var r = PEARL_R * scale * k;

      // Ореол под жемчужиной: на радужной пене белый спрайт сам по себе
      // теряется, а подложка отделяет его от плёнки.
      var g = cx.createRadialGradient(x, y, 0, x, y, r * 2.2);
      g.addColorStop(0, 'rgba(255,240,255,0.45)');
      g.addColorStop(1, 'rgba(255,240,255,0)');
      cx.fillStyle = g;
      cx.beginPath();
      cx.arc(x, y, r * 2.2, 0, TAU);
      cx.fill();

      var im = IMG.pearl;
      if (im) {
        var h = r * 2.8, w = h * (im.width / im.height);
        cx.drawImage(im, x - w / 2, y - h / 2, w, h);
        continue;
      }
      cx.fillStyle = '#ffffff';
      cx.beginPath();
      cx.arc(x, y, r * 0.62, 0, TAU);
      cx.fill();
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

  /* Растущая капля живёт внутри общей пены, поэтому от неё нужно только
     одно, чего у застывших нет: сигнал «я ещё расту, останови меня».
     Пульсирующее кольцо снаружи контура, и оно же вспыхивает белым при
     близком промахе мимо угля. */
  function drawGrowRing(cx, g, time) {
    var r = g.r * scale;
    var x = sx(g.x), y = sy(g.y);
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

  /* Уголь — спрайт с мордой, а не светящийся кружок. Свечение всё равно
     рисуем кодом: оно должно пульсировать и гаснуть у спящих, а вшитое в
     картинку это не умеет. Спящий уголь показывается тусклым и мельче —
     разница читается с одного взгляда, как и была задумана. */
  function ember(cx, x, y, r, pulse, dim) {
    var R = r * 1.6 * pulse;

    cx.save();
    var g = cx.createRadialGradient(x, y, 0, x, y, R * 1.3);
    g.addColorStop(0, dim ? 'rgba(255,150,80,0.30)' : 'rgba(255,170,90,0.55)');
    g.addColorStop(1, 'rgba(255,107,53,0)');
    cx.fillStyle = g;
    cx.beginPath();
    cx.arc(x, y, R * 1.3, 0, TAU);
    cx.fill();
    cx.restore();

    var im = IMG.ember;
    if (im) {
      // Спрайт нарисован каплей вверх, вписываем по высоте.
      var h = R * 2.1, w = h * (im.width / im.height);
      cx.save();
      cx.globalAlpha = dim ? 0.45 : 1;
      cx.drawImage(im, x - w / 2, y - h / 2, w, h);
      cx.restore();
      return;
    }

    // Картинка ещё не пришла — рисуем запасной уголёк.
    cx.fillStyle = dim ? 'rgba(255,180,120,0.5)' : EMBER_CORE;
    cx.beginPath();
    cx.arc(x, y, r * 0.6, 0, TAU);
    cx.fill();
  }

  /* Где уголь окажется через ahead секунд. Маятник ходит по своей орбите,
     летящие отражаются от стенок поля и от барьеров; пульсар и спящий
     стоят на месте, для них предсказывать нечего. */
  function predict(h, ahead) {
    if (h.type === 'pulsar' || h.type === 'sleep') return null;
    if (h.type === 'pend') {
      var a = h.ang + h.w * ahead;
      return { x: h.cx + Math.cos(a) * h.orbit, y: h.cy + Math.sin(a) * h.orbit };
    }
    if (h.vx === undefined) return null;

    /* Отражение считаем точно, разворачиванием, а не шагами по времени.
       Шагами получалось дёргано: у стенки отскок то попадал внутрь шага,
       то нет, и призрак прыгал от кадра к кадру. Здесь же путь сначала
       продлевается по прямой, а потом складывается обратно в поле —
       результат непрерывен, сколько бы отскоков ни случилось.

       Барьеры при этом не учитываются: их отражение так не сворачивается.
       Плавная подсказка, которая изредка ошибается у барьера, полезнее
       точной, но дёргающейся. */
    return {
      x: fold(h.x + h.vx * ahead, h.r, FIELD_W - h.r),
      y: fold(h.y + h.vy * ahead, h.r, FIELD_H - h.r)
    };
  }

  /* Складывает координату обратно в отрезок [lo, hi], отражая от концов —
     как если бы точка отскакивала от стенок сколько угодно раз. */
  function fold(v, lo, hi) {
    var span = hi - lo;
    if (span <= 0) return lo;
    var m = (v - lo) % (span * 2);
    if (m < 0) m += span * 2;
    return lo + (m <= span ? m : span * 2 - m);
  }

  function drawHazard(cx, h, time) {
    var x = sx(h.x), y = sy(h.y);
    var pulse = 1 + Math.sin(time * 6 + h.ph) * 0.12;

    /* «Предчувствие»: бледный призрак там, где уголь окажется через
       секунду. Превращает реакцию в расчёт — можно ставить каплю туда,
       откуда уголь уже ушёл, вместо того чтобы угадывать.

       Считаем шагами с отражением от стенок, а не по прямой. Прямая врёт
       ровно там, где предсказание нужнее всего: у края поля, куда уголь
       как раз и летит перед отскоком. */
    if (upLvl('radar')) {
      var gp = predict(h, 1);
      if (gp) {
        cx.strokeStyle = 'rgba(255,150,80,0.32)';
        cx.lineWidth = Math.max(1, 1.2 * us);
        cx.beginPath();
        cx.arc(sx(gp.x), sy(gp.y), h.r * scale, 0, TAU);
        cx.stroke();
      }
    }

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
      var x = ox + fw - (i * 18 + 8) * us, ly = 24 * us, lr = 6.5 * us;
      var live = i < lives;

      // Жизнь — маленький пузырь: то же стекло, что и на поле, только
      // потраченный гаснет и остаётся пустым контуром.
      cx.beginPath();
      cx.arc(x, ly, lr, 0, TAU);
      if (live && foam) {
        cx.save();
        cx.clip();
        foam.sheen(cx, x - lr, ly - lr, lr * 2, lr * 2, 1);
        /* Холодная подкраска обязательна. Кусок плёнки такого размера
           часто попадает на тёплый участок текстуры, и жизнь начинает
           выглядеть как уголь — то есть ровно наоборот тому, что она
           значит. Тёплый цвет в этой игре занят смертью. */
        cx.fillStyle = 'rgba(120,150,255,0.42)';
        cx.fillRect(x - lr, ly - lr, lr * 2, lr * 2);
        var lg2 = cx.createRadialGradient(x - lr * 0.35, ly - lr * 0.4, 0, x, ly, lr);
        lg2.addColorStop(0, 'rgba(255,255,255,0.8)');
        lg2.addColorStop(0.6, 'rgba(255,255,255,0)');
        lg2.addColorStop(1, 'rgba(0,0,0,0.35)');
        cx.fillStyle = lg2;
        cx.fillRect(x - lr, ly - lr, lr * 2, lr * 2);
        cx.restore();
      } else {
        cx.fillStyle = 'rgba(255,255,255,0.06)';
        cx.fill();
      }
      cx.strokeStyle = live ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.22)';
      cx.lineWidth = Math.max(1, 1.2 * us);
      cx.beginPath();
      cx.arc(x, ly, lr, 0, TAU);
      cx.stroke();
    }

    if (runCoins > 0) text(cx, '◈ ' + runCoins, ox, 45 * us, 12, 'rgba(255,255,255,0.6)', 'left', 700);

    // Множитель появляется только когда он есть: пустая строка в
    // интерфейсе стоит внимания и ничего не сообщает.
    var m = multiplier();
    if (m > 1.001) {
      var mp = 1 + Math.min(streak, 10) * 0.012;
      text(cx, '×' + m.toFixed(1), W / 2, 46 * us, 14 * mp, p.accent, 'center', 800);
    }

    /* Шкала — стеклянная трубка, в которую наливается та же плёнка. Пустая
       часть почти чёрная, налитая переливается: видно не только «сколько»,
       но и «чего» — того же вещества, из которого игрок строит поле. */
    var bw = fw, bh = 9 * us, by = oy - 15 * us;
    roundRect(cx, ox, by, bw, bh, bh / 2);
    cx.fillStyle = 'rgba(8,10,28,0.85)';
    cx.fill();

    var k = clamp(filled / target, 0, 1);
    if (k > 0) {
      var fillW = Math.max(bh, bw * k);
      cx.save();
      roundRect(cx, ox, by, fillW, bh, bh / 2);
      cx.clip();
      if (!foam.sheen(cx, ox, by, bw, bh, 1)) {
        cx.fillStyle = p.accent;
        cx.fillRect(ox, by, fillW, bh);
      }
      var lg = cx.createLinearGradient(0, by, 0, by + bh);
      lg.addColorStop(0, 'rgba(255,255,255,0.45)');
      lg.addColorStop(0.6, 'rgba(255,255,255,0)');
      cx.fillStyle = lg;
      cx.fillRect(ox, by, fillW, bh);
      cx.restore();

      if (k >= 1) {
        cx.save();
        cx.shadowColor = 'rgba(255,255,255,0.9)';
        cx.shadowBlur = 12 * us;
        cx.strokeStyle = '#ffffff';
        cx.lineWidth = Math.max(1, 1.6 * us);
        roundRect(cx, ox, by, bw, bh, bh / 2);
        cx.stroke();
        cx.restore();
      }
    }

    cx.strokeStyle = 'rgba(255,255,255,0.35)';
    cx.lineWidth = Math.max(1, 1.2 * us);
    roundRect(cx, ox, by, bw, bh, bh / 2);
    cx.stroke();
    text(cx, Math.round(k * 100) + '%', ox + bw, 45 * us, 12,
      k >= 1 ? '#ffffff' : p.dim, 'right', 700);
  }

  function overlay(cx, p, alpha) {
    cx.fillStyle = 'rgba(4,5,18,' + alpha.toFixed(2) + ')';
    cx.fillRect(0, 0, W, H);
    // Виньетка: собирает взгляд к центру, где стоят кнопки.
    var g = cx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25,
                                    W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    cx.fillStyle = g;
    cx.fillRect(0, 0, W, H);
  }

  /* Заголовок с радужным ореолом. Заливать сам текст плёнкой канвас не
     умеет без отдельного холста, а на слабом телефоне это лишний буфер
     каждый кадр; свечение позади даёт тот же эффект впятеро дешевле. */
  function glowTitle(cx, str, x, y, size) {
    var r = size * us * 2.2;
    var g = cx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(196,120,255,0.45)');
    g.addColorStop(0.45, 'rgba(90,180,255,0.22)');
    g.addColorStop(1, 'rgba(90,180,255,0)');
    cx.fillStyle = g;
    cx.beginPath();
    cx.arc(x, y, r, 0, TAU);
    cx.fill();

    cx.save();
    cx.shadowColor = 'rgba(150,120,255,0.9)';
    cx.shadowBlur = 18 * us;
    text(cx, str, x, y, size, '#ffffff', 'center', 800);
    cx.restore();
  }

  function drawMenu(cx, p) {
    overlay(cx, p, 0.82);
    var mid = W / 2;
    var top = H * 0.24;

    glowTitle(cx, T.t('title'), mid, top, 50);
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
    var bx = W / 2 - rowW / 2, rh = 46 * us;
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
          var y = top + idx * 52 * us;
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
                useSkinFilm();
                S.click();
              } else if (save.coins >= sk.cost) {
                save.coins -= sk.cost;
                save.owned[idx] = 1;
                save.skin = idx;
                useSkinFilm();
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

    /* Застывшие капли и растущая рисуются одной пеной, а не по очереди:
       растущая должна прижиматься к соседям так же, как остальные, иначе
       она читается как чужой объект, наложенный сверху. */
    var i;
    var cluster = drops;
    if (growing) {
      cluster = drops.slice();
      cluster.push(growing);
    }
    foam.draw(cx, cluster, {
      x: ox, y: oy, w: FIELD_W * scale, h: FIELD_H * scale
    }, sx, sy, scale, skinTint(level));
    if (growing) drawGrowRing(cx, growing, t);
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

    /* Управление удержанием: держишь — капля растёт, отпустил — застыла.
       Раньше было два отдельных тапа, и это читалось хуже: между «поставил»
       и «остановил» терялась связь с рукой. Здесь рост длится ровно столько,
       сколько палец на экране, — прямой физический контроль.

       Повторное нажатие, пока капля растёт, игнорируем: палец уже держит,
       второе касание может прийти только случайно. */
    if (growing) return;
    if (fromKey) { placeAt(kb.x, kb.y); return; }
    placeAt((x - ox) / scale, (y - oy) / scale);
  }

  /* Отпустили — капля застывает. Координаты не важны: важно, что отпустили. */
  function onRelease() {
    if (state !== 'play' || !growing) return;
    freeze();
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
    foam = new global.Foam();
    // Текстуру подберём после загрузки сохранения — скин ещё неизвестен.
    foam.load('assets/film.jpg');
    loadImage('ember', 'assets/ember.png');
    loadImage('pearl', 'assets/pearl.png');
    core = new global.Core('game');
    core.onResize = layout;
    core.onUpdate = update;
    core.onRender = render;
    core.onPress = onPress;
    core.onRelease = onRelease;
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
        useSkinFilm();
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

  /* Единственный след режима съёмки в боевой сборке. Без engine/shot.js
     условие ложно, и блок не выполняется — наружу ничего лишнего не уезжает.

     Ботов в съёмке нет: сцену расставляем руками и просим отрисовать один
     кадр. Поэтому она работает и в headless, где игровой цикл не крутится. */
  if (global.Shot) {
    global.Shot.attach({
      C: { FIELD_W: FIELD_W, FIELD_H: FIELD_H, MIN_R: MIN_R, MAX_R: MAX_R,
           WALL_HALF: WALL_HALF, PEARL_R: PEARL_R, TAU: TAU },
      getState: function () { return state; },
      setState: function (v) { state = v; },
      world: function () {
        return { drops: drops, hazards: hazards, walls: walls, pearls: pearls,
                 parts: parts, waves: waves, motes: motes };
      },
      clear: function () {
        drops = []; hazards = []; walls = []; pearls = [];
        parts = []; waves = []; growing = null; filled = 0;
      },
      setup: setupLevel,
      drop: function (x, y, r) {
        drops.push({ x: x, y: y, r: r, born: 0 });
        filled += Math.PI * r * r;
      },
      // Растущая капля — главный кадр игры: по ней сразу видно, в чём выбор.
      grow: function (x, y, r, near) {
        growing = { x: x, y: y, r: r, tick: 0, near: near || 0 };
      },
      ember: function (kind, x, y, vx, vy, r) {
        var h = { type: kind, x: x, y: y, vx: vx, vy: vy, r: r,
                  ph: 0, trail: kind === 'comet' ? [] : null };
        hazards.push(h);
        return h;
      },
      wall: function (x1, y1, x2, y2) {
        walls.push({ x1: x1, y1: y1, x2: x2, y2: y2 });
      },
      pearl: function (x, y) {
        pearls.push({ x: x, y: y, taken: 0, ph: 0 });
      },
      set: function (o) {
        if (o.level !== undefined) level = o.level;
        if (o.score !== undefined) score = o.score;
        if (o.lives !== undefined) lives = o.lives;
        if (o.best !== undefined) save.best = o.best;
        if (o.bestLevel !== undefined) save.bestLevel = o.bestLevel;
        if (o.coins !== undefined) save.coins = o.coins;
        if (o.skin !== undefined) save.skin = o.skin;
        if (o.owned !== undefined) save.owned = o.owned;
        if (o.up !== undefined) save.up = o.up;
        if (o.target !== undefined) target = o.target;
        if (o.filled !== undefined) filled = o.filled;
        if (o.shopTab !== undefined) shopTab = o.shopTab;
        if (o.hint !== undefined) { hintText = o.hint; hintTime = 9; }
      },
      freeze: function () { core.paused = true; },
      render: function () { render(core.ctx); },
      // Для видео: симуляция крутится вручную, по кадру за вызов, чтобы
      // запись не зависела от requestAnimationFrame и повторялась точно.
      step: function (dt) { update(dt); },
      place: placeAt,
      stop: function () { if (growing) freeze(); },
      startRun: startRun
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, false);
  } else {
    boot();
  }
})(window);
