/**
 * Облачное хранилище для сайта «Бюджет свадьбы».
 * Вставьте этот код в Apps Script Google-таблицы (Расширения → Apps Script)
 * и разверните как веб-приложение: «Выполнять от имени: Я», «Доступ: Все».
 * Данные хранятся в вашей таблице: лист «Таблица» — для чтения, лист «data» — служебный.
 */

function doGet() {
  return out_({ ok: true, data: read_() });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = JSON.parse(e.postData.contents);
    var incoming = body && body.data;
    if (!incoming || !Array.isArray(incoming.events) || !Array.isArray(incoming.items)) {
      return out_({ ok: false, error: 'Неверный формат данных' });
    }
    var stored = read_();
    var merged = merge_(stored, incoming);
    if (JSON.stringify(merged) !== JSON.stringify(stored)) {
      writeTable_(merged);
      write_(merged);
    }
    return out_({ ok: true, data: merged });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* Объединение: по каждой записи побеждает более свежее изменение, удаления учитываются. */
function merge_(a, b) {
  if (!a) return b;
  if (!b) return a;
  var del = {};
  [a.deleted || {}, b.deleted || {}].forEach(function (d) {
    Object.keys(d).forEach(function (k) { del[k] = Math.max(del[k] || 0, d[k]); });
  });
  function pick(x, y) {
    var map = {}, order = [];
    (x || []).concat(y || []).forEach(function (it) {
      var cur = map[it.id];
      if (!cur) order.push(it.id);
      if (!cur || (it.updatedAt || 0) > (cur.updatedAt || 0)) map[it.id] = it;
    });
    return order.map(function (id) { return map[id]; })
      .filter(function (it) { return !(del[it.id] >= (it.updatedAt || 0)); });
  }
  var events = pick(a.events, b.events).sort(function (p, q) { return (p.order || 0) - (q.order || 0); });
  return { v: 2, events: events, items: pick(a.items, b.items), deleted: del };
}

function sheet_(name) {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function read_() {
  var s = sheet_('data');
  var n = s.getLastRow();
  if (!n) return null;
  var text = s.getRange(1, 1, n, 1).getValues().map(function (r) { return String(r[0]).slice(1); }).join('');
  return text ? JSON.parse(text) : null;
}

function write_(data) {
  var s = sheet_('data');
  s.clear();
  var text = JSON.stringify(data), rows = [];
  // префикс «x», чтобы таблица не приняла кусок за число или формулу
  for (var i = 0; i < text.length; i += 40000) rows.push(['x' + text.slice(i, i + 40000)]);
  s.getRange(1, 1, rows.length, 1).setNumberFormat('@').setValues(rows);
}

function writeTable_(d) {
  var s = sheet_('Таблица');
  s.clear();
  var rows = [['Мероприятие', 'Расход', 'План', 'Итог', 'Оплачено', 'Осталось', 'Статус', 'Заметка']];
  d.events.forEach(function (ev) {
    d.items.filter(function (it) { return it.event === ev.id; }).forEach(function (it) {
      var paid = (it.payments || []).reduce(function (a, p) { return a + (Number(p.amount) || 0); }, 0);
      var cost = it.actual != null ? it.actual : (it.planned || 0);
      rows.push([txt_(ev.name), txt_(it.name), it.planned || 0, it.actual != null ? it.actual : '', paid,
        it.closed ? 0 : Math.max(cost - paid, 0),
        it.closed ? 'Закрыто' : paid > 0 ? 'Аванс внесён' : 'Запланировано', txt_(it.note || '')]);
    });
  });
  s.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  s.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
  s.setFrozenRows(1);
  if (rows.length > 1) s.getRange(2, 3, rows.length - 1, 4).setNumberFormat('#,##0');
}

// текст, начинающийся с = + - @, таблица иначе посчитает формулой
function txt_(v) {
  v = String(v);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
