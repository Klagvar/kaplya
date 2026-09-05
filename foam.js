/* Отрисовка мыльной пены.
 *
 * Заменяет прежние «кружки с перемычками». Перемычки рисовались фокусом —
 * две касательные точки и кривая между ними, — и разваливались ровно там,
 * где игра становится интересной: при сильном перекрытии касательные
 * выворачивались в песочные часы, а когда рядом оказывались три капли,
 * каждая пара чертила свою шейку поверх чужих.
 *
 * Здесь геометрия настоящая. Две прижавшиеся мыльные плёнки образуют между
 * собой перегородку, и лежит она на радикальной оси двух окружностей — той
 * самой линии, где степени точки относительно обеих окружностей равны.
 * Три пузыря сходятся в одной точке сами собой, без особого случая: каждый
 * просто обрезан перегородками со всеми соседями. Это диаграмма Лагерра, и
 * пена в жизни устроена именно так.
 *
 * Рисуем в четыре прохода, а не по пузырю за раз: так текстура плёнки
 * кладётся одним куском на всё пятно и не «нарезается» по границам клеток.
 *
 *   1. Силуэт объединения, залитый текстурой переливов.
 *   2. Объём: у каждой клетки тёмный край и светлый бок.
 *   3. Перегородки между соседями.
 *   4. Внешний контур — только видимые дуги, без линий внутри пятна.
 *
 * Ограничения площадки учтены: никакого ctx.filter и никаких режимов
 * наложения сложнее 'lighter' — ВК крутит игры в старых Android WebView.
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;

  /* Пузыри вдавливаются друг в друга по-настоящему: рост останавливается
     не в момент касания, а когда перекрытие дошло до предела (см. growDrop
     в game.js). Поэтому рисовать здесь нечего подкручивать — радиус на
     экране равен игровому, и то, что игрок видит, совпадает с тем, по чему
     считаются столкновения.

     Первая версия шла обратным путём: физика останавливалась по касанию, а
     вдавливание было рисованным, на 19%. Гроздь выглядела правильно, но
     пузырь на экране обгонял настоящий, и касание угля читалось раньше,
     чем происходило. На быстрых уровнях это нечестно по отношению к игроку. */
  var WOBBLE = 0.012;   // насколько плёнка дышит, доля радиуса

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* Радикальная ось: расстояние от центра A до перегородки вдоль линии
     центров. При равных радиусах даёт ровно середину. */
  function wallOffset(d, ra, rb) {
    return (d * d + ra * ra - rb * rb) / (2 * d);
  }

  function Foam() {
    this.film = null;         // текстура переливов
    this.filmReady = false;
    this.t = 0;
  }

  /* Текстура плёнки. Меняется вместе со скином, поэтому грузится не один
     раз на старте, а при каждой смене — зато в памяти всегда одна, а не
     весь набор. Пока новая едет, игра рисует прежней: подменять картинку
     посреди забега мельканием нельзя. */
  Foam.prototype.load = function (src) {
    if (this._src === src) return;
    this._src = src;
    var self = this;
    var img = new global.Image();
    img.onload = function () {
      self.film = img;
      self.filmReady = true;
      self._pat = undefined;   // образец для интерфейса пересоберётся сам
    };
    // Не грузится — не беда: рисуем прежней или вовсе без неё.
    img.onerror = function () { self._src = null; };
    img.src = src;
  };

  Foam.prototype.step = function (dt) { this.t += dt; _t = this.t; };

  /* Радиус, с которым пузырь участвует в геометрии пены. Равен игровому
     плюс лёгкое дыхание: мыльная плёнка не бывает неподвижной, и без этого
     гроздь выглядит замороженной. Фаза берётся из координат пузыря, чтобы
     ничего не хранить и чтобы соседи дышали вразнобой. */
  var _t = 0;
  function fatR(d) {
    return d.r * (1 + Math.sin(_t * 1.7 + d.x * 0.09 + d.y * 0.05) * WOBBLE);
  }

  /* Соседи, с которыми есть общая перегородка. Заодно отсекаем случай
     «один пузырь внутри другого» — там перегородки нет. */
  function neighbours(list, i) {
    var a = list[i], out = [], ra = fatR(a);
    for (var j = 0; j < list.length; j++) {
      if (j === i) continue;
      var b = list[j], rb = fatR(b);
      var dx = b.x - a.x, dy = b.y - a.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.001 || d >= ra + rb) continue;
      if (d + Math.min(ra, rb) <= Math.max(ra, rb)) continue;
      out.push({ b: b, d: d, ang: Math.atan2(dy, dx), rb: rb });
    }
    return out;
  }

  /* --- 1. Силуэт --------------------------------------------------------
     Путь из всех окружностей сразу. Заливка по правилу nonzero склеивает
     их в одну фигуру, поэтому внутренних краёв не остаётся. */
  Foam.prototype.unionPath = function (cx, list, sx, sy, k) {
    cx.beginPath();
    var i, j;
    for (i = 0; i < list.length; i++) {
      var d = list[i];
      cx.moveTo(sx(d.x) + fatR(d) * k, sy(d.y));
      cx.arc(sx(d.x), sy(d.y), fatR(d) * k, 0, TAU);
    }
  };

  /* Текстура кладётся на всё пятно разом и медленно плывёт. Мелкий поворот
     не берём: на старых телефонах вращение большой картинки каждый кадр
     стоит дороже, чем выглядит. */
  Foam.prototype.fillFilm = function (cx, x, y, w, h, tint) {
    if (this.filmReady) {
      var img = this.film;
      /* Плитка примерно в две трети поля. Растягивать текстуру на весь
         экран нельзя: завитки расплываются, и вместо переливов мыльной
         плёнки получается мыло в буквальном смысле. При таком масштабе на
         один пузырь приходится несколько завитков, как на референсе. */
      var sc = Math.max(w, h) / img.width * 0.66;
      var tw = img.width * sc, th = img.height * sc;
      /* Плитки отражаем через одну. Текстура не бесшовная — при обычном
         повторе по стыку идёт прямая линия поперёк пузыря, и вся иллюзия
         плёнки рассыпается. Зеркало склеивает края сами с собой. */
      var i0 = Math.floor(((this.t * 7) % (tw * 2)) / tw);
      var j0 = Math.floor(((this.t * 4) % (th * 2)) / th);
      var ox = x - ((this.t * 7) % tw) - tw;
      var oy = y - ((this.t * 4) % th) - th;
      var ci = 0;
      for (var px = ox; px < x + w + tw; px += tw, ci++) {
        var cj = 0;
        for (var py = oy; py < y + h + th; py += th, cj++) {
          var fx = ((ci + i0) % 2) ? -1 : 1;
          var fy = ((cj + j0) % 2) ? -1 : 1;
          /* Рисуем на пиксель больше, чем шаг. Плитки ложатся на дробные
             координаты, и между ними остаётся незакрашенная щель — на
             тёмном фоне она видна тонкой чёрной полосой поперёк пузыря.
             Перекрытие её закрывает, а зеркальные края всё равно совпадают,
             так что лишний пиксель ничего не портит. */
          cx.save();
          cx.translate(px + (fx < 0 ? tw + 1 : 0), py + (fy < 0 ? th + 1 : 0));
          cx.scale(fx, fy);
          cx.drawImage(img, 0, 0, tw + 1, th + 1);
          cx.restore();
        }
      }
    } else {
      cx.fillStyle = '#2a3f7a';
      cx.fillRect(x, y, w, h);
    }
    // Тон глубины поверх переливов: с уровнями вода холодеет и темнеет,
    // а плёнка остаётся той же. Дешевле, чем вторая текстура.
    if (tint) {
      cx.fillStyle = tint;
      cx.fillRect(x, y, w, h);
    }
  };

  /* Обрезает текущий путь полуплоскостями всех соседей — то есть оставляет
     от круга ровно клетку Лагерра. Полуплоскость задаём прямоугольником
     заведомо больше поля: canvas пересекает области clip, поэтому
     последовательные вызовы дают именно пересечение. */
  function clipCell(cx, list, i, sx, sy, k, box) {
    var a = list[i], ra = fatR(a);
    var big = (box.w + box.h) * 2;
    var ns = neighbours(list, i);
    for (var n = 0; n < ns.length; n++) {
      var s = ns[n];
      var off = wallOffset(s.d, ra, s.rb);
      var ux = Math.cos(s.ang), uy = Math.sin(s.ang);
      var px = -uy, py = ux;
      // Точка на стенке в игровых координатах, дальше всё в экранных.
      var mx = sx(a.x + ux * off), my = sy(a.y + uy * off);
      var sxu = ux, syu = uy;     // направление «в сторону соседа»

      cx.beginPath();
      cx.moveTo(mx + px * big, my + py * big);
      cx.lineTo(mx - px * big, my - py * big);
      cx.lineTo(mx - px * big - sxu * big, my - py * big - syu * big);
      cx.lineTo(mx + px * big - sxu * big, my + py * big - syu * big);
      cx.closePath();
      cx.clip();
    }
  }

  /* Плёнка как материал для интерфейса. Кнопки, шкала и жизни сделаны из
     того же, из чего пузыри, — иначе они выглядят приклеенными поверх
     чужой игры.

     Здесь принципиально не тот способ, что на поле. Мозаику из зеркальных
     плиток нельзя звать по десять раз за кадр: элементов интерфейса много,
     и на каждый приходился цикл с масштабированием картинки 768×768 — на
     съёмке это вешало браузер намертво, а на телефоне уронило бы кадры.
     Поэтому один раз готовим маленький образец и заливаем им как краской:
     один fillRect вместо цикла. Швы на мелких элементах не видны. */
  Foam.prototype.pattern = function (cx) {
    if (this._pat !== undefined) return this._pat;
    if (!this.filmReady) return null;
    /* Образец берём покрупнее: на кнопке шириной в треть экрана плитка
       в 96 пикселей повторяется на глаз, и вместо плёнки читается обои. */
    var side = 192;
    var buf = global.document.createElement('canvas');
    buf.width = side;
    buf.height = side;
    buf.getContext('2d').drawImage(this.film, 0, 0, side, side);
    this._pat = cx.createPattern(buf, 'repeat');
    return this._pat;
  };

  Foam.prototype.sheen = function (cx, x, y, w, h, alpha) {
    var pat = this.pattern(cx);
    if (!pat) return false;
    cx.save();
    cx.globalAlpha = alpha;
    cx.fillStyle = pat;
    cx.fillRect(x, y, w, h);
    cx.restore();
    return true;
  };

  /* О перепонках между близкими пузырями.

     В настоящей пене между соседями, которые ещё не сомкнулись, натянута
     плёнка, и у тройки соседей она одна, со стыком посередине. Я пробовал
     строить её галтелями — дугами, касающимися обоих пузырей снаружи, — и
     складывать их в общий силуэт, чтобы тройной стык получался сам.

     Убрано. Дуга галтели может уйти в обратную сторону, и вместо плёнки в
     зазоре рисуются лепестки выше и ниже него; надёжно определить нужное
     направление обхода у меня не вышло за несколько попыток. Плюс с тех
     пор, как капли вдавливаются друг в друга по-настоящему, зазор между
     застывшими каплями почти не встречается — плёнка успевала мелькнуть
     только во время роста. То есть цена высокая, а случай редкий.

     Если возвращать: направление обхода надо считать по знаку векторного
     произведения, а рисовать только между застывшими каплями. */

  /* --- Главное ---------------------------------------------------------- */

  /* list — капли {x, y, r}. box — прямоугольник поля в экранных координатах.
     sx, sy — перевод игровых координат в экранные, k — масштаб. */
  Foam.prototype.draw = function (cx, list, box, sx, sy, k, tint) {
    if (!list.length) return;

    // 1. Плёнка внутри силуэта.
    cx.save();
    this.unionPath(cx, list, sx, sy, k);
    cx.clip();
    this.fillFilm(cx, box.x, box.y, box.w, box.h, tint);
    cx.restore();

    var i, j, n;

    // 2. Объём каждой клетки: тёмный ободок внутрь и светлый бок.
    for (i = 0; i < list.length; i++) {
      var d = list[i];
      var x = sx(d.x), y = sy(d.y), r = fatR(d) * k;
      if (r < 2) continue;

      /* Обрезаем не по кругу, а по клетке: круг ∩ полуплоскости всех
         соседей. По кругу получались тёмные линзы на каждом пересечении —
         край одного пузыря затемнял соседа поверх общей стенки, и вместо
         плёнки выходила грязь. */
      cx.save();
      cx.beginPath();
      cx.arc(x, y, r, 0, TAU);
      cx.clip();
      clipCell(cx, list, i, sx, sy, k, box);

      /* Объём. Стенка пузыря тонкая, поэтому у края плёнка идёт «на просвет»
         и темнеет, а к самому контуру снова вспыхивает — это и читается как
         стекло. Без второй, светлой ступени пузырь выглядит наклейкой. */
      var sh = cx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
      sh.addColorStop(0, 'rgba(255,255,255,0.20)');
      sh.addColorStop(0.5, 'rgba(255,255,255,0)');
      sh.addColorStop(0.78, 'rgba(6,8,26,0.20)');
      sh.addColorStop(0.94, 'rgba(6,8,26,0.40)');
      sh.addColorStop(0.985, 'rgba(255,255,255,0.30)');
      sh.addColorStop(1, 'rgba(255,255,255,0.05)');
      cx.fillStyle = sh;
      cx.fillRect(x - r, y - r, r * 2, r * 2);

      // Блик — вытянутое пятно на верхнем левом плече, как на всех
      // мыльных пузырях: источник света один и он сверху.
      var hx = x - r * 0.36, hy = y - r * 0.42, hr = r * 0.3;
      var hi = cx.createRadialGradient(hx, hy, 0, hx, hy, hr);
      hi.addColorStop(0, 'rgba(255,255,255,0.9)');
      hi.addColorStop(1, 'rgba(255,255,255,0)');
      cx.fillStyle = hi;
      cx.save();
      cx.translate(hx, hy);
      cx.rotate(-0.6);
      cx.scale(1, 0.55);
      cx.translate(-hx, -hy);
      cx.beginPath();
      cx.arc(hx, hy, hr, 0, TAU);
      cx.fill();
      cx.restore();

      cx.restore();
    }

    // 3. Перегородки. Каждую пару берём один раз — j больше i.
    cx.lineCap = 'round';
    for (i = 0; i < list.length; i++) {
      var a = list[i], ra = fatR(a);
      for (j = i + 1; j < list.length; j++) {
        var b = list[j], rb = fatR(b);
        var dx = b.x - a.x, dy = b.y - a.y;
        var dd = Math.sqrt(dx * dx + dy * dy);
        if (dd < 0.001 || dd >= ra + rb) continue;
        if (dd + Math.min(ra, rb) <= Math.max(ra, rb)) continue;

        // Полухорда перегородки — половина её видимой длины.
        var off = wallOffset(dd, ra, rb);
        var half = Math.sqrt(Math.max(0, ra * ra - off * off));
        if (half < 0.5) continue;

        var ux = dx / dd, uy = dy / dd;
        var mx = a.x + ux * off, my = a.y + uy * off;
        var px = -uy, py = ux;

        cx.beginPath();
        cx.moveTo(sx(mx + px * half), sy(my + py * half));
        cx.lineTo(sx(mx - px * half), sy(my - py * half));
        cx.strokeStyle = 'rgba(255,255,255,0.55)';
        cx.lineWidth = Math.max(1, 1.6 * k * 0.5);
        cx.stroke();
      }
    }

    // 4. Внешний контур: только те дуги, которые не съедены соседями.
    for (i = 0; i < list.length; i++) {
      var c = list[i];
      var cr = fatR(c);
      var cx0 = sx(c.x), cy0 = sy(c.y), rr = cr * k;
      if (rr < 2) continue;

      var ns = neighbours(list, i);
      var cuts = [];
      for (n = 0; n < ns.length; n++) {
        var s = ns[n];
        var cosA = (s.d * s.d + cr * cr - s.rb * s.rb) / (2 * s.d * cr);
        var A = Math.acos(clamp(cosA, -1, 1));
        cuts.push([s.ang - A, s.ang + A]);
      }

      strokeVisibleArcs(cx, cx0, cy0, rr, cuts, k);
    }

  };

  /* Обводит окружность, пропуская закрытые соседями участки.
     Интервалы приводим к [0, 2π), режем те, что переходят через ноль,
     сливаем пересекающиеся — и обводим то, что осталось между ними. */
  function strokeVisibleArcs(cx, x, y, r, cuts, k) {
    var norm = [], i;
    for (i = 0; i < cuts.length; i++) {
      var a = cuts[i][0], b = cuts[i][1];
      var span = b - a;
      if (span >= TAU) return;              // закрыт целиком
      a = ((a % TAU) + TAU) % TAU;
      b = a + span;
      if (b > TAU) {
        norm.push([a, TAU]);
        norm.push([0, b - TAU]);
      } else {
        norm.push([a, b]);
      }
    }
    norm.sort(function (p, q) { return p[0] - q[0]; });

    var merged = [];
    for (i = 0; i < norm.length; i++) {
      var last = merged[merged.length - 1];
      if (last && norm[i][0] <= last[1]) {
        if (norm[i][1] > last[1]) last[1] = norm[i][1];
      } else {
        merged.push([norm[i][0], norm[i][1]]);
      }
    }

    cx.strokeStyle = 'rgba(255,255,255,0.85)';
    cx.lineWidth = Math.max(1.2, 2 * k * 0.5);
    cx.beginPath();
    if (!merged.length) {
      cx.arc(x, y, r, 0, TAU);
    } else {
      for (i = 0; i < merged.length; i++) {
        var from = merged[i][1];
        var to = (i + 1 < merged.length) ? merged[i + 1][0] : merged[0][0] + TAU;
        if (to - from > 0.01) {
          cx.moveTo(x + Math.cos(from) * r, y + Math.sin(from) * r);
          cx.arc(x, y, r, from, to);
        }
      }
    }
    cx.stroke();
  }

  global.Foam = Foam;
})(window);
