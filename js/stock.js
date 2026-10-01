// Inventory as a movement log per item, in the item's stock unit (کیلو / لیتر / عدد):
// in = purchase invoices, use = standard consumption of served days, count = stock-taking differences, adjust = manual fixes
const Stock = (() => {
  const { fa, num, esc, store } = Core;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const A = () => window.App;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const KEY = 'ash.stockLog', KCOUNT = 'ash.counts';
  let log = store.get(KEY, null);
  const counts = store.get(KCOUNT, []);
  // first run: the amounts typed by hand in the old version become the opening stock
  if (!Array.isArray(log)) {
    log = Object.entries(store.get('ash.stock', {})).filter(([, v]) => num(v) > 0)
      .map(([item, v]) => ({ id: uid(), item, qty: num(v), type: 'open', date: Core.todayISO(), ts: Date.now(), note: 'موجودی اولیه' }));
    store.set(KEY, log);
  }
  const save = () => store.set(KEY, log);
  const saveCounts = () => store.set(KCOUNT, counts);

  const TYPES = { open: 'موجودی اولیه', in: 'ورود با فاکتور خرید', use: 'مصرف استاندارد', count: 'انبارگردانی', adjust: 'اصلاح دستی' };
  const PACK_UNITS = ['بسته', 'کارتن', 'شانه', 'کیسه'];
  const items = () => A().data?.items || {};
  const unitOf = (id) => Core.buyUnitLabel(items()[id]?.unit);
  const qtyFmt = (v, id) => `${fa(v, 3)} ${unitOf(id)}`;
  const tiny = (v) => Math.abs(v) < 1e-6;

  function current() {
    const m = new Map();
    for (const x of log) m.set(x.item, (m.get(x.item) || 0) + x.qty);
    return m;
  }
  // positive stock per item, used by the purchase calculation
  const currentObj = () => Object.fromEntries([...current()].filter(([, v]) => v > 0));
  // price of one stock unit (one کیلو / لیتر / عدد) from the selected price
  function unitPrices() {
    const prices = A().prices;
    return (id) => { const o = Core.pickPrice(prices[id]); return o ? num(o.price) / num(o.size) : 0; };
  }

  // ---------- purchase invoices
  function lineToStock(l) {
    const it = items()[l.itemId];
    if (!it || !(num(l.qty) > 0)) return 0;
    if (l.unit === Core.buyUnitLabel(it.unit)) return num(l.qty);
    if (PACK_UNITS.includes(l.unit) && num(l.size) > 0) return num(l.qty) * num(l.size);
    return 0;
  }
  function removeRef(ref) {
    log = log.filter((x) => x.ref !== ref);
    save();
  }
  // (re)writes the stock entries of one invoice; returns how many lines could not enter the stock
  function syncInvoice(inv) {
    log = log.filter((x) => x.ref !== inv.id);
    let skipped = 0;
    for (const l of inv.lines || []) {
      if (!l.itemId) continue;
      const q = lineToStock(l);
      if (q > 0) log.push({ id: uid(), item: l.itemId, qty: q, type: 'in', ref: inv.id, date: inv.date, ts: Date.now(), note: `فاکتور${inv.no ? ` ${inv.no}` : ''}${l.brand ? ` — ${l.brand}` : ''}` });
      else skipped++;
    }
    save();
    return skipped;
  }

  // ---------- consumption of served days
  function recentDates() {
    const out = [];
    const d = new Date();
    for (let i = 0; i < 7; i++) {
      const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
      out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`);
    }
    return out;
  }
  function openConsume(prefill = {}) {
    const S = A().settings;
    const data = A().data;
    const plan = data?.plans.find((p) => p.id === S.planId);
    if (!plan) { A().toast('اول در صفحه «محاسبه» گروه هتل و برنامه غذایی را انتخاب کنید'); return A().show('calc'); }
    let days = [...(prefill.days || [])];
    const dates = recentDates();
    const draw = () => {
      A().openSheet(`<h3>🍽 ثبت مصرف از انبار</h3>
        <p class="hint" style="margin:-6px 0 10px">مصرف استاندارد روزهای سرو‌شده طبق «${esc(plan.name)}» از موجودی کم می‌شود.</p>
        <label class="field"><span>تاریخ</span><select id="cuDate">${dates.map((d, i) => `<option value="${d}">${i === 0 ? 'امروز — ' : i === 1 ? 'دیروز — ' : ''}${Core.jText(d)}</option>`).join('')}</select></label>
        <div class="field"><span class="flabel">کدام روزهای برنامه سرو شد؟</span><div class="chips" id="cuDays">${plan.days.map((d, i) => `<button type="button" class="chip ${days.includes(i) ? 'on' : ''}" data-d="${i}">${esc(d.name)}</button>`).join('')}</div></div>
        <label class="field"><span>تعداد زائر</span><input id="cuPil" inputmode="numeric" value="${fa(prefill.pilgrims || S.pilgrims || 0)}"></label>
        <div class="calc" id="cuPreview">—</div>
        <button class="btn" id="cuSave">ثبت مصرف</button>
        <button class="link" style="width:100%" id="cuCancel">انصراف</button>`);
      $$('#cuDays .chip').forEach((b) => (b.onclick = () => {
        const i = +b.dataset.d;
        days = days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort((a, b2) => a - b2);
        b.classList.toggle('on');
        preview();
      }));
      $('#cuPil').oninput = preview;
      $('#cuCancel').onclick = A().closeSheet;
      $('#cuSave').onclick = saveUse;
      preview();
    };
    const rowsFor = () => {
      const pil = num($('#cuPil').value);
      if (!days.length || !(pil > 0)) return [];
      return Core.calculate({ data, plan, dayIdxs: days, pilgrims: pil, prices: {}, stock: {}, rate: 0, groupId: S.group }).rows.filter((r) => !r.asNeeded && r.need > 0);
    };
    function preview() {
      const rows = rowsFor();
      const up = unitPrices();
      const value = rows.reduce((s, r) => s + (r.need / Core.buyFactor(r.unit)) * up(r.id), 0);
      $('#cuPreview').textContent = rows.length ? `${fa(rows.length)} قلم از انبار کم می‌شود${value ? ` — ارزش تقریبی: ${fa(Math.round(value))} دینار` : ''}` : 'روزها و تعداد زائر را انتخاب کنید';
    }
    function saveUse() {
      const rows = rowsFor();
      if (!rows.length) return A().toast('روزها و تعداد زائر را انتخاب کنید');
      const date = $('#cuDate').value;
      const pil = num($('#cuPil').value);
      const label = `${days.map((i) => plan.days[i].name).join('، ')} — ${fa(pil)} زائر`;
      if (log.some((x) => x.type === 'use' && x.date === date && x.note === label) && !confirm('همین مصرف برای این تاریخ قبلاً ثبت شده است. دوباره ثبت شود؟')) return;
      const batch = uid();
      const ts = Date.now();
      for (const r of rows) log.push({ id: uid(), item: r.id, qty: -(r.need / Core.buyFactor(r.unit)), type: 'use', batch, date, ts, note: label });
      save();
      A().closeSheet();
      A().toast('مصرف از انبار کم شد ✅');
      if (document.querySelector('#scr-stock.on')) render();
    }
    draw();
  }

  // ---------- stock taking (انبارگردانی)
  function openCount() {
    const cur = current();
    const planIds = new Set();
    const S = A().settings, data = A().data;
    const plan = data?.plans.find((p) => p.id === S.planId);
    if (plan) for (const [id, n] of Core.perPersonNeeds(data, plan, plan.days.map((_, i) => i))) if (n.perPerson > 0) planIds.add(id);
    const list = Object.entries(items()).filter(([id]) => planIds.has(id) || !tiny(cur.get(id) || 0))
      .map(([id, it]) => ({ id, ...it })).sort(Core.byCat);
    A().openSheet(`<h3>📋 انبارگردانی</h3>
      <p class="hint" style="margin:-6px 0 10px">موجودی واقعی هر قلم را بشمارید و بنویسید. قلمی را که نمی‌شمارید خالی بگذارید. اختلاف شمارش با موجودی دفتری، «کسری» یا «اضافه» حساب می‌شود.</p>
      ${list.map((it) => `<div class="row stockrow" style="margin-bottom:6px"><span class="name">${esc(it.name)}<br><small style="color:var(--muted);font-weight:400">دفتری: ${qtyFmt(cur.get(it.id) || 0, it.id)}</small></span>
        <div class="suffix"><input data-c="${esc(it.id)}" inputmode="decimal" placeholder="شمارش"><em>${unitOf(it.id)}</em></div></div>`).join('')}
      <button class="btn" id="ctSave" style="margin-top:10px">ثبت انبارگردانی</button>
      <button class="link" style="width:100%" id="ctCancel">انصراف</button>`);
    $('#ctCancel').onclick = A().closeSheet;
    $('#ctSave').onclick = () => {
      const up = unitPrices();
      const rows = $$('#sheet [data-c]').filter((i) => i.value.trim() !== '').map((i) => {
        const id = i.dataset.c, book = cur.get(id) || 0, actual = num(i.value);
        return { item: id, name: items()[id].name, book, actual, diff: actual - book, up: up(id) };
      });
      if (!rows.length) return A().toast('حداقل یک قلم را بشمارید');
      const rec = { id: uid(), date: Core.todayISO(), ts: Date.now(), rows };
      counts.unshift(rec);
      saveCounts();
      for (const r of rows) if (!tiny(r.diff)) log.push({ id: uid(), item: r.item, qty: r.diff, type: 'count', ref: rec.id, date: rec.date, ts: rec.ts, note: r.diff < 0 ? 'کسری' : 'اضافه' });
      save();
      render();
      openCountReport(rec.id);
    };
  }

  function countTotals(rec) {
    let short = 0, extra = 0;
    for (const r of rec.rows) { const v = r.diff * r.up; if (v < 0) short -= v; else extra += v; }
    return { short, extra };
  }
  function openCountReport(id) {
    const rec = counts.find((c) => c.id === id);
    if (!rec) return;
    const t = countTotals(rec);
    const diffs = rec.rows.filter((r) => !tiny(r.diff)).sort((a, b) => a.diff * a.up - b.diff * b.up);
    A().openSheet(`<h3>نتیجه انبارگردانی — ${Core.jText(rec.date)}</h3>
      <div class="summary">
        <div class="stat bad"><div class="k">کسری (مصرف بیش از استاندارد یا ضایعات)</div><div class="v">${fa(Math.round(t.short))} دینار</div></div>
        <div class="stat ok"><div class="k">اضافه</div><div class="v">${fa(Math.round(t.extra))} دینار</div></div>
      </div>
      <p class="hint">${fa(rec.rows.length)} قلم شمارش شد؛ ${fa(diffs.length)} قلم اختلاف داشت. موجودی انبار با شمارش شما اصلاح شد.</p>
      <div class="recipe"><ul class="ing">${diffs.length ? diffs.map((r) => `<li><span>${esc(r.name)}<br><small style="color:var(--muted)">دفتری ${fa(r.book, 3)} — شمارش ${fa(r.actual, 3)} ${unitOf(r.item)}</small></span>
        <b class="${r.diff < 0 ? 'neg' : 'pos'}">${r.diff < 0 ? 'کسری' : 'اضافه'} ${fa(Math.abs(r.diff), 3)}${r.up ? `<br><small>${fa(Math.round(Math.abs(r.diff * r.up)))} دینار</small>` : ''}</b></li>`).join('') : '<li>همه اقلام با موجودی دفتری برابر بود ✅</li>'}</ul></div>
      <div class="btn-row"><button class="btn ghost" id="crPrint">🖨 چاپ</button><button class="btn danger" id="crDel">لغو این انبارگردانی</button></div>`);
    $('#crPrint').onclick = () => {
      const body = rec.rows.map((r, i) => `<tbody class="${i % 2 ? 'alt' : ''}"><tr><td class="c">${fa(i + 1)}</td><td>${esc(r.name)}</td><td class="c">${unitOf(r.item)}</td>
        <td class="n">${fa(r.book, 3)}</td><td class="n">${fa(r.actual, 3)}</td><td class="n">${tiny(r.diff) ? '—' : `${r.diff < 0 ? 'کسری' : 'اضافه'} ${fa(Math.abs(r.diff), 3)}`}</td><td class="n">${r.up && !tiny(r.diff) ? fa(Math.round(Math.abs(r.diff * r.up))) : '—'}</td></tr></tbody>`).join('');
      A().printDoc(`<h1>گزارش انبارگردانی — آشپزیار</h1>
        <p class="pmeta">تاریخ: ${Core.jText(rec.date)} — کسری: ${fa(Math.round(t.short))} دینار — اضافه: ${fa(Math.round(t.extra))} دینار</p>
        <table><colgroup><col style="width:6%"><col style="width:30%"><col style="width:9%"><col style="width:13%"><col style="width:13%"><col style="width:15%"><col style="width:14%"></colgroup>
        <thead><tr><th>ردیف</th><th>کالا</th><th>واحد</th><th>موجودی دفتری</th><th>شمارش</th><th>اختلاف</th><th>مبلغ (دینار)</th></tr></thead>${body}</table>
        <p class="pmeta" style="margin-top:4mm">کسری یعنی کالایی که بیش از مصرف استاندارد جدول دورچین مصرف یا ضایع شده است.</p>`);
    };
    $('#crDel').onclick = () => {
      if (!confirm('این انبارگردانی لغو شود و موجودی به قبل از آن برگردد؟')) return;
      removeRef(rec.id);
      counts.splice(counts.indexOf(rec), 1);
      saveCounts();
      A().closeSheet();
      render();
    };
  }

  // ---------- item card (کاردکس)
  function openItem(id) {
    const it = items()[id];
    const mv = log.filter((x) => x.item === id).sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
    let run = 0;
    const rows = mv.map((x) => { run += x.qty; return { x, bal: run }; }).reverse();
    A().openSheet(`<h3>${esc(it.name)}</h3>
      <div class="summary"><div class="stat wide"><div class="k">موجودی فعلی</div><div class="v ${run < -1e-6 ? 'neg' : ''}">${qtyFmt(run, id)}</div></div></div>
      <div class="recipe"><ul class="ing">${rows.length ? rows.map(({ x, bal }) => `<li><span>${Core.jShort(x.date)} — ${TYPES[x.type]}${x.note && x.type !== 'open' ? `<br><small style="color:var(--muted)">${esc(x.note)}</small>` : ''}</span>
        <b><span class="${x.qty < 0 ? 'neg' : 'pos'}">${x.qty < 0 ? '−' : '+'}${fa(Math.abs(x.qty), 3)}</span><br><small style="font-weight:400">مانده ${fa(bal, 3)}</small>${x.type === 'adjust' ? ` <button class="mini red" data-del="${x.id}" style="min-height:28px">✕</button>` : ''}</b></li>`).join('') : '<li>گردشی ثبت نشده</li>'}</ul></div>
      <button class="btn ghost" id="itAdj" style="margin-top:10px">✎ اصلاح دستی (ضایعات، اشتباه ثبت…)</button>`);
    $$('#sheet [data-del]').forEach((b) => (b.onclick = () => {
      if (!confirm('این اصلاح حذف شود؟')) return;
      log = log.filter((x) => x.id !== b.dataset.del);
      save(); render(); openItem(id);
    }));
    $('#itAdj').onclick = () => openAdjust(id);
  }
  function openAdjust(id) {
    const it = items()[id];
    A().openSheet(`<h3>اصلاح دستی — ${esc(it.name)}</h3>
      <div class="toggle" id="adDir"><button type="button" data-d="-1" class="on">کم شود</button><button type="button" data-d="1">زیاد شود</button></div>
      <label class="field"><span>مقدار</span><div class="suffix"><input id="adQty" inputmode="decimal"><em>${unitOf(id)}</em></div></label>
      <label class="field"><span>علت</span><select id="adWhy"><option>ضایعات / خرابی</option><option>مصرف خارج از برنامه</option><option>اشتباه در ثبت</option><option>سایر</option></select></label>
      <label class="field"><span>توضیح (اختیاری)</span><input id="adNote"></label>
      <button class="btn" id="adSave">ثبت</button>
      <button class="link" style="width:100%" id="adBack">← بازگشت</button>`);
    $$('#adDir button').forEach((b) => (b.onclick = () => $$('#adDir button').forEach((x) => x.classList.toggle('on', x === b))));
    setTimeout(() => $('#adQty')?.focus(), 250);
    $('#adBack').onclick = () => openItem(id);
    $('#adSave').onclick = () => {
      const q = num($('#adQty').value);
      if (!(q > 0)) return A().toast('مقدار را وارد کنید');
      const dir = +$('#adDir button.on').dataset.d;
      const note = [$('#adWhy').value, $('#adNote').value.trim()].filter(Boolean).join(' — ');
      log.push({ id: uid(), item: id, qty: dir * q, type: 'adjust', date: Core.todayISO(), ts: Date.now(), note });
      save(); render(); openItem(id);
    };
  }

  // ---------- screen
  let scope = 'have', q = '';
  function render() {
    const el = $('#scr-stock');
    if (!el || !A().data) return;
    const cur = current();
    const up = unitPrices();
    let value = 0, negatives = 0;
    for (const [id, v] of cur) { if (v > 0) value += v * up(id); if (v < -1e-6) negatives++; }
    const batches = [...new Map(log.filter((x) => x.type === 'use').map((x) => [x.batch, x])).values()].sort((a, b) => b.ts - a.ts).slice(0, 5);
    el.innerHTML = `<div class="banner info">موجودی با <b>ثبت فاکتور خرید</b> (در بخش مالی) زیاد و با <b>ثبت مصرف</b> کم می‌شود. برای شمارش واقعی انبار و پیدا کردن کسری، <b>انبارگردانی</b> را بزنید.</div>
      <div class="grid2btn"><button class="btn" id="sUse">🍽 ثبت مصرف</button><button class="btn ghost" id="sCount">📋 انبارگردانی</button></div>
      <div class="summary" style="margin-top:12px">
        <div class="stat"><div class="k">ارزش موجودی انبار</div><div class="v">${fa(Math.round(value))} دینار</div></div>
        <div class="stat ${negatives ? 'bad' : ''}"><div class="k">${negatives ? 'اقلام با موجودی منفی' : 'اقلام موجود'}</div><div class="v">${fa(negatives || [...cur.values()].filter((v) => v > 1e-6).length)}</div></div>
      </div>
      ${negatives ? '<p class="hint" style="margin-top:-6px">موجودی منفی یعنی بیشتر از خریدهای ثبت‌شده مصرف ثبت شده؛ احتمالاً فاکتوری ثبت نشده است.</p>' : ''}
      <div class="toggle" id="sScope"><button data-s="have" class="${scope === 'have' ? 'on' : ''}">موجودها</button><button data-s="plan" class="${scope === 'plan' ? 'on' : ''}">اقلام برنامه من</button><button data-s="all" class="${scope === 'all' ? 'on' : ''}">همه</button></div>
      <input class="search" id="sSearch" placeholder="🔍 جستجوی قلم…" value="${esc(q)}">
      <div id="sList"></div>
      ${batches.length ? `<div class="cat-title">آخرین ثبت‌های مصرف</div>${batches.map((b) => `<div class="row"><div class="top"><span class="name" style="font-weight:600">${Core.jText(b.date)}</span><button class="mini red" data-undo="${b.batch}">لغو</button></div><div class="meta">${esc(b.note)}</div></div>`).join('')}` : ''}
      ${counts.length ? `<div class="cat-title">انبارگردانی‌های قبلی</div>${counts.slice(0, 10).map((c) => { const t = countTotals(c); return `<div class="row tap" data-count="${c.id}"><div class="top"><span class="name">${Core.jText(c.date)}</span><span class="cost neg">کسری ${fa(Math.round(t.short))} دینار</span></div><div class="meta">${fa(c.rows.length)} قلم شمارش شد</div></div>`; }).join('')}` : ''}`;
    $('#sUse').onclick = () => openConsume();
    $('#sCount').onclick = openCount;
    $$('#sScope button').forEach((b) => (b.onclick = () => { scope = b.dataset.s; render(); }));
    $('#sSearch').oninput = (e) => { q = e.target.value.trim(); renderList(); };
    Core.bindFaFix($('#sSearch'), () => Object.values(items()).map((it) => it.name));
    $$('#scr-stock [data-undo]').forEach((b) => (b.onclick = () => {
      if (!confirm('این ثبت مصرف لغو شود و مقادیرش به انبار برگردد؟')) return;
      log = log.filter((x) => x.batch !== b.dataset.undo);
      save(); render();
    }));
    $$('#scr-stock [data-count]').forEach((r) => (r.onclick = () => openCountReport(r.dataset.count)));
    renderList();
  }
  function renderList() {
    const cur = current();
    const up = unitPrices();
    const S = A().settings, data = A().data;
    let ids;
    if (scope === 'have') ids = [...cur.keys()].filter((id) => !tiny(cur.get(id)));
    else if (scope === 'plan') {
      const plan = data.plans.find((p) => p.id === S.planId);
      ids = plan ? [...Core.perPersonNeeds(data, plan, plan.days.map((_, i) => i))].filter(([, n]) => n.perPerson > 0).map(([id]) => id) : [];
    } else ids = Object.keys(items());
    const list = ids.filter((id) => items()[id] && Core.matchText(items()[id].name, q)).map((id) => ({ id, ...items()[id] })).sort(Core.byCat);
    let html = '', cat = null;
    for (const it of list) {
      if (it.cat !== cat) { cat = it.cat; html += `<div class="cat-title">${esc(cat || 'سایر')}</div>`; }
      const v = cur.get(it.id) || 0;
      html += `<div class="row tap" data-item="${esc(it.id)}"><div class="top"><span class="name">${esc(it.name)}</span><span class="cost ${v < -1e-6 ? 'neg' : ''}">${qtyFmt(v, it.id)}</span></div>
        ${v > 0 && up(it.id) ? `<div class="meta"><span>ارزش: ${fa(Math.round(v * up(it.id)))} دینار</span></div>` : ''}</div>`;
    }
    $('#sList').innerHTML = html || `<div class="empty">${scope === 'have' ? 'هنوز چیزی در انبار نیست.<br>با ثبت فاکتور خرید در بخش «مالی»، اقلام وارد انبار می‌شوند.' : 'موردی پیدا نشد.'}</div>`;
    $$('#sList [data-item]').forEach((r) => (r.onclick = () => openItem(r.dataset.item)));
  }

  return { render, current, currentObj, syncInvoice, removeRef, openConsume, lineToStock, PACK_UNITS, exportData: () => ({ stockLog: log, counts }) };
})();
window.Stock = Stock;
