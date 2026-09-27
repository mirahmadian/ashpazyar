// Simple per-device ledger: purchase invoices, payments, receipts, charges (amounts owed to us), parties, caravans and reports
const Ledger = (() => {
  const { fa, num, esc, store } = Core;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const A = () => window.App;

  const KEY = 'ash.ledger';
  const L = Object.assign({ parties: [], caravans: [], entries: [] }, store.get(KEY, {}));
  const save = () => store.set(KEY, L);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const CUR = { IQD: 'دینار', USD: 'دلار' };
  const amt = (n, cur) => (cur === 'USD' ? `${fa(n, 2)} دلار` : `${fa(Math.round(n))} دینار`);
  const PTYPES = { supplier: 'فروشنده / بنکدار', company: 'شرکت / زیارتی', hotel: 'هتل', other: 'سایر' };
  const KINDS = {
    invoice: ['🧾', 'فاکتور خرید'],
    pay: ['📤', 'پرداخت'],
    receive: ['📥', 'دریافت'],
    charge: ['📌', 'ثبت طلب'],
  };
  const UNITS = ['بسته', 'کارتن', 'کیلو', 'عدد', 'لیتر', 'شانه', 'کیسه'];

  const party = (id) => L.parties.find((p) => p.id === id);
  const caravan = (id) => L.caravans.find((c) => c.id === id);
  const hotelOf = (e) => e.hotelId || caravan(e.caravanId)?.hotelId || null;

  // ---------- money logic
  const lineTotal = (l) => num(l.qty) * num(l.price);
  const invTotal = (e) => (e.lines || []).reduce((s, l) => s + lineTotal(l), 0);
  // positive = we owe this party more; negative = the party owes us more
  function owe(e) {
    if (e.kind === 'invoice') return invTotal(e) - num(e.paid);
    if (e.kind === 'pay') return -num(e.amount);
    if (e.kind === 'receive') return num(e.amount);
    if (e.kind === 'charge') return -num(e.amount);
    return 0;
  }
  const expenseOf = (e) => (e.kind === 'invoice' ? invTotal(e) : e.kind === 'pay' && !e.partyId ? num(e.amount) : 0);
  const cashOut = (e) => (e.kind === 'invoice' ? num(e.paid) : e.kind === 'pay' ? num(e.amount) : 0);
  const entryAmount = (e) => (e.kind === 'invoice' ? invTotal(e) : num(e.amount));

  function balances(until) {
    const out = new Map();
    for (const e of L.entries) {
      if (!e.partyId || (until && e.date > until)) continue;
      const b = out.get(e.partyId) || { IQD: 0, USD: 0 };
      b[e.cur] += owe(e);
      out.set(e.partyId, b);
    }
    return out;
  }
  function balanceText(v, cur) {
    if (Math.abs(v) < (cur === 'USD' ? 0.005 : 0.5)) return '<span style="color:var(--muted)">تسویه</span>';
    return v > 0
      ? `<span class="neg">بدهکارید: ${amt(v, cur)}</span>`
      : `<span class="pos">طلبکارید: ${amt(-v, cur)}</span>`;
  }

  // ---------- small UI helpers
  function dateField(id, iso) {
    const [y, m, d] = Core.isoToJ(iso || Core.todayISO());
    const days = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${i + 1 === d ? 'selected' : ''}>${Core.faN(i + 1)}</option>`).join('');
    const months = Core.J_MONTHS.map((n, i) => `<option value="${i + 1}" ${i + 1 === m ? 'selected' : ''}>${n}</option>`).join('');
    const years = [y - 2, y - 1, y, y + 1].map((v) => `<option value="${v}" ${v === y ? 'selected' : ''}>${Core.faN(v)}</option>`).join('');
    return `<div class="datepick" id="${id}"><select data-d aria-label="روز">${days}</select><select data-m aria-label="ماه">${months}</select><select data-y aria-label="سال">${years}</select></div>`;
  }
  function readDate(id) {
    const el = $('#' + id);
    const y = +$('[data-y]', el).value, m = +$('[data-m]', el).value;
    const d = Math.min(+$('[data-d]', el).value, Core.jMonthLen(y, m));
    return Core.jToIso(y, m, d);
  }
  const opts = (list, sel, empty) => (empty != null ? `<option value="">${empty}</option>` : '') +
    list.map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const curToggle = (cur) => `<div class="toggle" id="fCur" style="margin-bottom:12px">
    <button type="button" data-c="IQD" class="${cur === 'IQD' ? 'on' : ''}">دینار عراق</button>
    <button type="button" data-c="USD" class="${cur === 'USD' ? 'on' : ''}">دلار</button></div>`;
  function bindCur(onChange) {
    $$('#fCur button').forEach((b) => (b.onclick = () => {
      $$('#fCur button').forEach((x) => x.classList.toggle('on', x === b));
      onChange?.(b.dataset.c);
    }));
  }
  const readCur = () => $('#fCur button.on')?.dataset.c || 'IQD';

  function addPartyPrompt(type) {
    const name = prompt('نام طرف حساب جدید:');
    if (!name?.trim()) return null;
    const p = { id: uid(), name: name.trim(), type, phone: '' };
    L.parties.push(p);
    save();
    return p;
  }

  // ---------- main render
  let tab = 'entries';
  let report = { preset: 'month', from: null, to: null, cur: 'IQD' };

  function render() {
    const el = $('#scr-ledger');
    const lb = store.get('ash.lastBackup', null);
    const stale = L.entries.length && (!lb || Date.now() - new Date(lb).getTime() > 7 * 864e5);
    el.innerHTML = `${stale ? `<div class="banner warn" style="display:flex;gap:10px;align-items:center"><span style="flex:1">اطلاعات مالی فقط روی همین گوشی است. ${lb ? 'بیش از یک هفته' : 'تا حالا'} پشتیبان نگرفته‌اید.</span><button class="mini" id="lgBackup">پشتیبان بگیر</button></div>` : ''}
      <div class="toggle" id="lgTabs">
        <button data-t="entries" class="${tab === 'entries' ? 'on' : ''}">ثبت‌ها</button>
        <button data-t="parties" class="${tab === 'parties' ? 'on' : ''}">طرف حساب‌ها</button>
        <button data-t="report" class="${tab === 'report' ? 'on' : ''}">گزارش</button>
      </div><div id="lgBody"></div>`;
    $('#lgBackup')?.addEventListener('click', () => { A().backup(); setTimeout(render, 500); });
    $$('#lgTabs button').forEach((b) => (b.onclick = () => { tab = b.dataset.t; render(); }));
    ({ entries: renderEntries, parties: renderParties, report: renderReport })[tab]();
  }

  // ---------- entries list
  function renderEntries() {
    let h = `<div class="grid2btn">${Object.entries(KINDS).map(([k, [ic, n]]) => `<button class="btn ghost" data-new="${k}">${ic} ${n}</button>`).join('')}</div>
      <p class="hint" style="margin:8px 4px 0">«ثبت طلب» یعنی مبلغی که کسی به شما بدهکار است؛ مثلاً سهمیه دورچین یک کاروان که شرکت باید بپردازد.</p>`;
    const list = [...L.entries].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    if (!list.length) h += '<div class="empty"><div class="big">📒</div>هنوز چیزی ثبت نشده.<br>با دکمه‌های بالا اولین فاکتور یا پرداخت را ثبت کنید.</div>';
    let month = null;
    for (const e of list) {
      const [y, m] = Core.isoToJ(e.date);
      const mk = `${y}-${m}`;
      if (mk !== month) { month = mk; h += `<div class="cat-title">${Core.J_MONTHS[m - 1]} ${Core.faN(y)}</div>`; }
      const [ic, kn] = KINDS[e.kind];
      const p = party(e.partyId), c = caravan(e.caravanId);
      const rem = e.kind === 'invoice' ? invTotal(e) - num(e.paid) : 0;
      const title = p ? p.name : e.kind === 'pay' ? (e.note || 'هزینه متفرقه') : (e.note || kn);
      h += `<div class="row tap" data-e="${esc(e.id)}"><div class="top"><span class="name">${ic} ${esc(title)}</span><span class="cost">${amt(entryAmount(e), e.cur)}</span></div>
        <div class="meta"><span>${kn}${e.no ? ` ${esc(e.no)}` : ''}</span><span>${Core.jText(e.date)}</span>${c ? `<span>🚌 ${esc(c.name)}</span>` : ''}${rem > 0.001 ? `<span class="neg">مانده: ${amt(rem, e.cur)}</span>` : ''}</div></div>`;
    }
    $('#lgBody').innerHTML = h;
    $$('#lgBody [data-new]').forEach((b) => (b.onclick = () => openEntry(b.dataset.new)));
    $$('#lgBody [data-e]').forEach((r) => (r.onclick = () => { const e = L.entries.find((x) => x.id === r.dataset.e); openEntry(e.kind, e); }));
  }

  // ---------- entry form
  function openEntry(kind, existing, preset) {
    const e = existing ? structuredClone(existing) : Object.assign({ id: uid(), kind, date: Core.todayISO(), cur: 'IQD', partyId: '', caravanId: '', hotelId: '', note: '' },
      kind === 'invoice' ? { no: '', lines: [], paid: 0 } : { amount: '' }, preset || {});
    if (kind === 'invoice' && !e.lines.length) e.lines.push({ name: '', brand: '', qty: '', unit: 'بسته', price: '' });
    const [ic, kn] = KINDS[kind];
    const partyType = kind === 'invoice' || kind === 'pay' ? 'supplier' : 'company';
    const partyList = [...L.parties].sort((a, b) => (a.type === partyType ? 0 : 1) - (b.type === partyType ? 0 : 1) || a.name.localeCompare(b.name, 'fa'));
    const hotels = L.parties.filter((p) => p.type === 'hotel');
    const partyLabel = { invoice: 'فروشنده / بنکدار', pay: 'به چه کسی پرداختید؟ (خالی = هزینه متفرقه)', receive: 'از چه کسی دریافت کردید؟', charge: 'چه کسی به شما بدهکار است؟' }[kind];

    let h = `<h3>${ic} ${existing ? 'ویرایش' : 'ثبت'} ${kn}</h3>
      <div class="field"><span class="flabel">تاریخ</span>${dateField('fDate', e.date)}</div>
      <label class="field"><span>${partyLabel}</span><select id="fParty">${opts(partyList, e.partyId, kind === 'pay' ? '— هزینه متفرقه (بدون طرف حساب) —' : kind === 'invoice' ? '— خرید نقدی از فروشنده متفرقه —' : '— انتخاب کنید —')}<option value="__new">+ طرف حساب جدید…</option></select></label>
      <div class="grid2">
        <label class="field"><span>کاروان (اختیاری)</span><select id="fCaravan">${opts(L.caravans, e.caravanId, '—')}</select></label>
        <label class="field"><span>هتل (اختیاری)</span><select id="fHotel">${opts(hotels, hotelOf(e), '—')}</select></label>
      </div>
      ${curToggle(e.cur)}`;
    if (kind === 'invoice') {
      h += `<label class="field"><span>شماره فاکتور (اختیاری)</span><input id="fNo" value="${esc(e.no || '')}"></label>
        <div class="flabel" style="margin-bottom:6px">اقلام فاکتور</div><div id="fLines"></div>
        <button type="button" class="mini" id="fAddLine">+ افزودن ردیف</button>
        <div class="calc" id="fTotal" style="margin-top:12px">—</div>
        <label class="field"><span>مبلغ پرداخت‌شده</span><div style="display:flex;gap:8px"><input id="fPaid" inputmode="decimal" value="${num(e.paid) ? fa(e.paid, 2) : ''}" placeholder="۰ = کاملاً نسیه"><button type="button" class="mini" id="fPaidAll">همه را پرداختم</button></div></label>
        <p class="hint" id="fRemain" style="margin-top:-6px"></p>
        <label class="check" id="fUpdWrap" style="display:none"><input type="checkbox" id="fUpd" checked><span>قیمت‌های «فهرست قیمت‌ها» هم با قیمت این فاکتور به‌روز شود</span></label>`;
    } else {
      h += `<label class="field"><span>مبلغ</span><div class="suffix"><input id="fAmount" inputmode="decimal" value="${num(e.amount) ? fa(e.amount, 2) : ''}"><em id="fAmountCur">${CUR[e.cur]}</em></div></label>`;
      if (kind === 'charge') h += `<button type="button" class="mini" id="fAllowance" style="margin:-4px 0 12px">محاسبه سهمیه دورچین کاروان</button><p class="hint" id="fAllowHint" style="margin-top:-6px"></p>`;
    }
    h += `<label class="field"><span>توضیح (اختیاری)</span><input id="fNote" value="${esc(e.note || '')}"></label>
      <button class="btn" id="fSave">ذخیره</button>
      ${existing ? '<button class="link" style="width:100%;color:var(--bad)" id="fDel">حذف این ثبت</button>' : ''}
      <button class="link" style="width:100%" id="fCancel">انصراف</button>`;
    A().openSheet(h);

    // party quick add
    $('#fParty').onchange = (ev) => {
      if (ev.target.value !== '__new') return;
      const p = addPartyPrompt(partyType);
      ev.target.innerHTML = opts([...L.parties].sort((a, b) => a.name.localeCompare(b.name, 'fa')), p?.id || '', kind === 'pay' ? '— هزینه متفرقه (بدون طرف حساب) —' : kind === 'invoice' ? '— خرید نقدی از فروشنده متفرقه —' : '— انتخاب کنید —') + '<option value="__new">+ طرف حساب جدید…</option>';
    };
    $('#fCaravan').onchange = () => {
      const c = caravan($('#fCaravan').value);
      if (c?.hotelId) $('#fHotel').value = c.hotelId;
      if (kind === 'charge' && c?.companyId && !$('#fParty').value) $('#fParty').value = c.companyId;
    };
    bindCur((c) => { if ($('#fAmountCur')) $('#fAmountCur').textContent = CUR[c]; if (kind === 'invoice') updTotal(); });

    // invoice lines
    const items = Object.entries(A().data?.items || {});
    const itemByName = (n) => items.find(([, it]) => it.name === n.trim());
    function drawLines() {
      $('#fLines').innerHTML = e.lines.map((l, i) => `<div class="line" data-l="${i}">
        <div class="line-top"><input data-k="name" list="dlItems" value="${esc(l.name)}" placeholder="نام قلم"><button type="button" class="x" data-del>✕</button></div>
        <input data-k="brand" list="dlBrands" value="${esc(l.brand || '')}" placeholder="ویژند (برند) — اختیاری">
        <div class="line-grid line-head"><span>مقدار</span><span>واحد</span><span>قیمت هر واحد</span></div>
        <div class="line-grid">
          <input data-k="qty" inputmode="decimal" value="${l.qty === '' ? '' : fa(l.qty, 3)}" placeholder="مقدار">
          <select data-k="unit">${[...new Set([...UNITS, l.unit])].map((u) => `<option ${u === l.unit ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
          <input data-k="price" inputmode="decimal" value="${l.price === '' ? '' : fa(l.price, 2)}" placeholder="قیمت هر واحد">
        </div><div class="line-sum" data-sum></div></div>`).join('') +
        `<datalist id="dlItems">${items.map(([, it]) => `<option value="${esc(it.name)}">`).join('')}</datalist>
         <datalist id="dlBrands">${A().allBrands().map((b) => `<option value="${esc(b)}">`).join('')}</datalist>`;
      $$('#fLines .line').forEach((row) => {
        const l = e.lines[+row.dataset.l];
        $$('[data-k]', row).forEach((inp) => (inp.onchange = () => {
          const k = inp.dataset.k;
          l[k] = k === 'qty' || k === 'price' ? (inp.value.trim() === '' ? '' : num(inp.value)) : inp.value.trim();
          if (k === 'name') {
            const hit = itemByName(l.name);
            l.itemId = hit?.[0] || null;
            l.cat = hit?.[1].cat || 'سایر';
            // prefill from the price list when the item is known
            const o = hit && Core.pickPrice(A().prices[hit[0]]);
            if (o && l.price === '') { l.brand = l.brand || o.b; l.price = num(o.price); l.unit = 'بسته'; l.size = num(o.size); drawLines(); }
          }
          if (k === 'brand' && l.itemId) {
            const opt = Core.normPrice(A().prices[l.itemId])?.list.find((x) => x.b === l.brand);
            if (opt) { l.size = num(opt.size); if (l.price === '') { l.price = num(opt.price); drawLines(); } }
          }
          if (k === 'qty' || k === 'price') inp.value = l[k] === '' ? '' : fa(l[k], k === 'qty' ? 3 : 2);
          updTotal();
        }));
        $('[data-del]', row).onclick = () => { e.lines.splice(+row.dataset.l, 1); if (!e.lines.length) e.lines.push({ name: '', brand: '', qty: '', unit: 'بسته', price: '' }); drawLines(); };
      });
      updTotal();
    }
    function updTotal() {
      if (kind !== 'invoice') return;
      const cur = readCur();
      $$('#fLines .line').forEach((row) => {
        const l = e.lines[+row.dataset.l];
        const t = lineTotal(l);
        $('[data-sum]', row).textContent = t ? `جمع ردیف: ${amt(t, cur)}` : '';
      });
      const total = invTotal(e);
      $('#fTotal').textContent = `جمع فاکتور: ${amt(total, cur)}`;
      const paid = num($('#fPaid').value);
      const rem = total - paid;
      $('#fRemain').innerHTML = rem > 0.001 ? `<span class="neg">مانده (نسیه): ${amt(rem, cur)}</span>` : paid > total + 0.001 ? '<span class="neg">مبلغ پرداخت‌شده بیشتر از جمع فاکتور است.</span>' : '<span class="pos">کاملاً پرداخت شده</span>';
      $('#fUpdWrap').style.display = e.lines.some((l) => l.itemId && l.unit === 'بسته' && num(l.size) > 0 && num(l.price) > 0) && cur === 'IQD' ? '' : 'none';
    }
    if (kind === 'invoice') {
      drawLines();
      $('#fAddLine').onclick = () => { e.lines.push({ name: '', brand: '', qty: '', unit: 'بسته', price: '' }); drawLines(); };
      $('#fPaid').oninput = updTotal;
      $('#fPaidAll').onclick = () => { $('#fPaid').value = fa(invTotal(e), 2); updTotal(); };
    }
    if (kind === 'charge') {
      $('#fAllowance').onclick = () => {
        const c = caravan($('#fCaravan').value);
        const g = A().data?.groups.find((x) => x.id === c?.groupId);
        if (!c || !g || !num(c.pilgrims) || !num(c.days)) {
          $('#fAllowHint').textContent = 'اول کاروان را انتخاب کنید. گروه هتل، تعداد زائر و تعداد روزهای کاروان باید در بخش «طرف حساب‌ها ← کاروان‌ها» ثبت شده باشد.';
          return;
        }
        const usd = g.usd * num(c.pilgrims) * num(c.days);
        $$('#fCur button').forEach((x) => x.classList.toggle('on', x.dataset.c === 'USD'));
        $('#fAmountCur').textContent = CUR.USD;
        $('#fAmount').value = fa(usd, 2);
        if (!$('#fNote').value) $('#fNote').value = `سهمیه دورچین ${c.name}`;
        $('#fAllowHint').textContent = `${fa(g.usd, 2)} دلار × ${fa(c.pilgrims)} زائر × ${fa(c.days)} روز (گروه ${g.name})`;
      };
    }

    $('#fCancel').onclick = A().closeSheet;
    const del = $('#fDel');
    if (del) del.onclick = () => {
      if (!confirm('این ثبت حذف شود؟')) return;
      L.entries = L.entries.filter((x) => x.id !== e.id);
      save();
      A().closeSheet();
      render();
    };
    $('#fSave').onclick = () => {
      e.date = readDate('fDate');
      e.partyId = $('#fParty').value === '__new' ? '' : $('#fParty').value;
      e.caravanId = $('#fCaravan').value;
      e.hotelId = $('#fHotel').value;
      e.cur = readCur();
      e.note = $('#fNote').value.trim();
      if (kind === 'invoice') {
        e.no = $('#fNo').value.trim();
        e.lines = e.lines.filter((l) => l.name && num(l.qty) > 0);
        if (!e.lines.length) { e.lines.push({ name: '', brand: '', qty: '', unit: 'بسته', price: '' }); return A().toast('حداقل یک قلم با مقدار وارد کنید'); }
        const noPrice = e.lines.filter((l) => !(num(l.price) > 0)).length;
        if (noPrice && !confirm(`${fa(noPrice)} ردیف قیمت ندارد و با مبلغ صفر ثبت می‌شود. ادامه می‌دهید؟`)) return;
        e.paid = num($('#fPaid').value);
        if (!e.partyId && invTotal(e) - e.paid > 0.001) return A().toast('برای خرید نسیه، فروشنده را انتخاب کنید');
        if ($('#fUpd')?.checked && $('#fUpdWrap').style.display !== 'none') updatePricesFrom(e);
      } else {
        e.amount = num($('#fAmount').value);
        if (!(e.amount > 0)) return A().toast('مبلغ را وارد کنید');
        if (kind !== 'pay' && !e.partyId) return A().toast('طرف حساب را انتخاب کنید');
      }
      const i = L.entries.findIndex((x) => x.id === e.id);
      if (i >= 0) L.entries[i] = e; else L.entries.push(e);
      save();
      A().closeSheet();
      A().toast('ثبت شد ✅');
      render();
    };
  }

  function updatePricesFrom(e) {
    const prices = A().prices;
    for (const l of e.lines) {
      if (!l.itemId || l.unit !== 'بسته' || !(num(l.size) > 0) || !(num(l.price) > 0)) continue;
      const p = Core.normPrice(prices[l.itemId]) || { sel: 0, list: [] };
      const opt = { b: l.brand || '', size: num(l.size), price: num(l.price), at: new Date().toISOString() };
      const k = p.list.findIndex((o) => o.b === opt.b);
      if (k >= 0) p.list[k] = opt; else p.list.push(opt);
      prices[l.itemId] = p;
    }
    A().savePrices();
  }

  // ---------- parties & caravans
  function renderParties() {
    const bal = balances();
    let h = `<div class="cat-title" style="display:flex;justify-content:space-between;align-items:center">طرف حساب‌ها <button class="mini" id="pNew">+ طرف حساب جدید</button></div>`;
    if (!L.parties.length) h += '<div class="row"><div class="meta">فروشنده‌ها، بنکداران، شرکت یا زیارتی و هتل‌ها را اینجا اضافه کنید.</div></div>';
    for (const type of Object.keys(PTYPES)) {
      for (const p of L.parties.filter((x) => x.type === type).sort((a, b) => a.name.localeCompare(b.name, 'fa'))) {
        const b = bal.get(p.id) || { IQD: 0, USD: 0 };
        const lines = ['IQD', 'USD'].filter((c) => Math.abs(b[c]) >= (c === 'USD' ? 0.005 : 0.5)).map((c) => balanceText(b[c], c));
        h += `<div class="row tap" data-p="${esc(p.id)}"><div class="top"><span class="name">${esc(p.name)}</span><span class="cost" style="font-weight:400;font-size:13px;color:var(--muted)">${PTYPES[p.type]}</span></div>
          <div class="meta">${lines.length ? lines.join('') : '<span>تسویه</span>'}</div></div>`;
      }
    }
    h += `<div class="cat-title" style="display:flex;justify-content:space-between;align-items:center;margin-top:24px">کاروان‌ها <button class="mini" id="cNew">+ کاروان جدید</button></div>`;
    if (!L.caravans.length) h += '<div class="row"><div class="meta">هر کاروان را یک بار ثبت کنید تا هزینه‌ها و سهمیه آن جدا حساب شود.</div></div>';
    for (const c of [...L.caravans].sort((a, b) => (b.start || '').localeCompare(a.start || ''))) {
      const hotel = party(c.hotelId);
      const spent = { IQD: 0, USD: 0 };
      for (const e of L.entries) if (e.caravanId === c.id) spent[e.cur] += expenseOf(e);
      h += `<div class="row tap" data-c="${esc(c.id)}"><div class="top"><span class="name">🚌 ${esc(c.name)}</span><span class="cost">${amt(spent.IQD, 'IQD')}</span></div>
        <div class="meta">${hotel ? `<span>🏨 ${esc(hotel.name)}</span>` : ''}${num(c.pilgrims) ? `<span>${fa(c.pilgrims)} زائر</span>` : ''}${num(c.days) ? `<span>${fa(c.days)} روز</span>` : ''}${c.start ? `<span>${Core.jText(c.start)}</span>` : ''}${spent.USD ? `<span>${amt(spent.USD, 'USD')}</span>` : ''}</div></div>`;
    }
    $('#lgBody').innerHTML = h;
    $('#pNew').onclick = () => openParty();
    $('#cNew').onclick = () => openCaravan();
    $$('#lgBody [data-p]').forEach((r) => (r.onclick = () => openStatement(r.dataset.p)));
    $$('#lgBody [data-c]').forEach((r) => (r.onclick = () => openCaravan(r.dataset.c)));
  }

  function openParty(id) {
    const p = id ? party(id) : { id: uid(), name: '', type: 'supplier', phone: '', note: '' };
    const used = !!id && (L.entries.some((e) => e.partyId === id || e.hotelId === id) || L.caravans.some((c) => c.hotelId === id || c.companyId === id));
    A().openSheet(`<h3>${id ? 'ویرایش' : 'افزودن'} طرف حساب</h3>
      <label class="field"><span>نام</span><input id="pName" value="${esc(p.name)}" placeholder="مثلاً بنکداری حاج رضا"></label>
      <label class="field"><span>نوع</span><select id="pType">${Object.entries(PTYPES).map(([k, n]) => `<option value="${k}" ${k === p.type ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="field"><span>تلفن (اختیاری)</span><input id="pPhone" inputmode="tel" dir="ltr" value="${esc(p.phone || '')}"></label>
      <label class="field"><span>توضیح (اختیاری)</span><input id="pNote" value="${esc(p.note || '')}"></label>
      <button class="btn" id="pSave">ذخیره</button>
      ${id ? `<button class="link" style="width:100%;color:var(--bad)" id="pDel" ${used ? 'disabled title="ثبت دارد"' : ''}>${used ? 'این طرف حساب ثبت دارد و قابل حذف نیست' : 'حذف'}</button>` : ''}`);
    setTimeout(() => $('#pName')?.focus(), 250);
    $('#pSave').onclick = () => {
      const name = $('#pName').value.trim();
      if (!name) return A().toast('نام را وارد کنید');
      Object.assign(p, { name, type: $('#pType').value, phone: $('#pPhone').value.trim(), note: $('#pNote').value.trim() });
      if (!id) L.parties.push(p);
      save();
      A().closeSheet();
      render();
    };
    const del = $('#pDel');
    if (del && !used) del.onclick = () => {
      if (!confirm(`«${p.name}» حذف شود؟`)) return;
      L.parties = L.parties.filter((x) => x.id !== id);
      save(); A().closeSheet(); render();
    };
  }

  function openCaravan(id) {
    const c = id ? caravan(id) : { id: uid(), name: '', hotelId: '', companyId: '', groupId: A().settings.group || '', pilgrims: A().settings.pilgrims || '', days: 6, start: Core.todayISO() };
    const used = id && L.entries.some((e) => e.caravanId === id);
    const groups = (A().data?.groups || []).map((g) => ({ id: g.id, name: `${g.name} (${fa(g.usd, 2)} دلار)` }));
    A().openSheet(`<h3>${id ? 'ویرایش' : 'افزودن'} کاروان</h3>
      <label class="field"><span>نام کاروان</span><input id="cName" value="${esc(c.name)}" placeholder="مثلاً کاروان ۱۲ — اعزام ۵ مهر"></label>
      <div class="field"><span class="flabel">تاریخ شروع</span>${dateField('cStart', c.start)}</div>
      <div class="grid2">
        <label class="field"><span>هتل</span><select id="cHotel">${opts(L.parties.filter((p) => p.type === 'hotel'), c.hotelId, '—')}</select></label>
        <label class="field"><span>شرکت / زیارتی</span><select id="cCompany">${opts(L.parties.filter((p) => p.type === 'company'), c.companyId, '—')}</select></label>
        <label class="field"><span>گروه قیمتی هتل</span><select id="cGroup">${opts(groups, c.groupId, '—')}</select></label>
        <label class="field"><span>تعداد زائر</span><input id="cPil" inputmode="numeric" value="${num(c.pilgrims) ? fa(c.pilgrims) : ''}"></label>
        <label class="field"><span>تعداد روز</span><input id="cDays" inputmode="numeric" value="${num(c.days) ? fa(c.days) : ''}"></label>
      </div>
      <p class="hint" style="margin-top:-4px">هتل و شرکت را اول در «طرف حساب‌ها» با نوع «هتل» و «شرکت / زیارتی» اضافه کنید.</p>
      <button class="btn" id="cSave">ذخیره</button>
      ${id ? `<button class="link" style="width:100%;color:var(--bad)" id="cDel">${used ? 'این کاروان ثبت دارد و قابل حذف نیست' : 'حذف'}</button>` : ''}`);
    $('#cSave').onclick = () => {
      const name = $('#cName').value.trim();
      if (!name) return A().toast('نام کاروان را وارد کنید');
      Object.assign(c, { name, start: readDate('cStart'), hotelId: $('#cHotel').value, companyId: $('#cCompany').value, groupId: $('#cGroup').value, pilgrims: num($('#cPil').value), days: num($('#cDays').value) });
      if (!id) L.caravans.push(c);
      save(); A().closeSheet(); render();
    };
    const del = $('#cDel');
    if (del && !used) del.onclick = () => {
      if (!confirm(`«${c.name}» حذف شود؟`)) return;
      L.caravans = L.caravans.filter((x) => x.id !== id);
      save(); A().closeSheet(); render();
    };
  }

  // party statement with running balance per currency
  function statementRows(pid) {
    const list = L.entries.filter((e) => e.partyId === pid).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const run = { IQD: 0, USD: 0 };
    return list.map((e) => { run[e.cur] += owe(e); return { e, eff: owe(e), bal: run[e.cur] }; });
  }
  function openStatement(pid) {
    const p = party(pid);
    const rows = statementRows(pid);
    const b = balances().get(pid) || { IQD: 0, USD: 0 };
    A().openSheet(`<h3>${esc(p.name)} <small style="font-weight:400;color:var(--muted)">— ${PTYPES[p.type]}</small></h3>
      ${p.phone ? `<p class="hint" style="margin-top:-8px">📞 <a href="tel:${esc(p.phone)}" dir="ltr">${esc(p.phone)}</a></p>` : ''}
      <div class="summary">${['IQD', 'USD'].map((c) => `<div class="stat"><div class="k">مانده ${CUR[c]}ی</div><div class="v" style="font-size:16px">${balanceText(b[c], c)}</div></div>`).join('')}</div>
      <div class="recipe"><ul class="ing">${rows.length ? rows.slice().reverse().map(({ e, eff, bal }) => `<li><span>${Core.jShort(e.date)} — ${KINDS[e.kind][1]}${e.no ? ` ${esc(e.no)}` : ''}<br><small style="color:var(--muted)">${eff >= 0 ? 'بدهی شما +' : 'بدهی شما −'}${amt(Math.abs(eff), e.cur)} ← مانده: ${bal >= 0 ? 'بدهکار' : 'طلبکار'} ${amt(Math.abs(bal), e.cur)}</small></span></li>`).join('') : '<li>ثبتی ندارد</li>'}</ul></div>
      <div class="btn-row"><button class="btn ghost" id="sPay">📤 پرداخت</button><button class="btn ghost" id="sRecv">📥 دریافت</button></div>
      <div class="btn-row"><button class="btn ghost" id="sPrint">🖨 چاپ صورت‌حساب</button><button class="btn ghost" id="sEdit">✎ ویرایش</button></div>`);
    $('#sPay').onclick = () => openEntry('pay', null, { partyId: pid });
    $('#sRecv').onclick = () => openEntry('receive', null, { partyId: pid });
    $('#sEdit').onclick = () => openParty(pid);
    $('#sPrint').onclick = () => {
      const body = rows.map(({ e, eff, bal }, i) => `<tbody class="${i % 2 ? 'alt' : ''}"><tr><td class="c">${fa(i + 1)}</td><td class="c">${Core.jShort(e.date)}</td><td>${KINDS[e.kind][1]}${e.no ? ` ${esc(e.no)}` : ''}${e.note ? ` — ${esc(e.note)}` : ''}</td>
        <td class="n">${eff > 0 ? fa(eff, e.cur === 'USD' ? 2 : 0) : ''}</td><td class="n">${eff < 0 ? fa(-eff, e.cur === 'USD' ? 2 : 0) : ''}</td><td class="n">${fa(Math.abs(bal), e.cur === 'USD' ? 2 : 0)} ${bal >= 0 ? 'بد' : 'طل'}</td><td class="c">${CUR[e.cur]}</td></tr></tbody>`).join('');
      A().printDoc(`<h1>صورت‌حساب ${esc(p.name)}</h1>
        <p class="pmeta">${PTYPES[p.type]} — تاریخ چاپ: ${Core.jText(Core.todayISO())} — مانده: ${['IQD', 'USD'].map((c) => balanceText(b[c], c)).join(' / ').replace(/<[^>]+>/g, '')}</p>
        <table><colgroup><col style="width:6%"><col style="width:13%"><col style="width:33%"><col style="width:13%"><col style="width:13%"><col style="width:14%"><col style="width:8%"></colgroup>
        <thead><tr><th>ردیف</th><th>تاریخ</th><th>شرح</th><th>بدهی شما +</th><th>بدهی شما −</th><th>مانده</th><th>ارز</th></tr></thead>${body}</table>
        <p class="pmeta" style="margin-top:4mm">«بد» = شما بدهکارید — «طل» = شما طلبکارید</p>`);
    };
  }

  // ---------- reports
  function rangeOf(preset) {
    const t = Core.todayISO();
    const [y, m] = Core.isoToJ(t);
    const now = new Date();
    if (preset === 'today') return [t, t];
    if (preset === 'week') {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 1) % 7));
      return [`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, t];
    }
    if (preset === 'month') return [Core.jToIso(y, m, 1), t];
    if (preset === 'lastmonth') { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; return [Core.jToIso(py, pm, 1), Core.jToIso(py, pm, Core.jMonthLen(py, pm))]; }
    if (preset === 'year') return [Core.jToIso(y, 1, 1), t];
    if (preset === 'all') return ['0000-00-00', '9999-99-99'];
    return [report.from || Core.jToIso(y, m, 1), report.to || t];
  }

  function computeReport(from, to, cur) {
    const inRange = L.entries.filter((e) => e.cur === cur && e.date >= from && e.date <= to);
    const sum = (f) => inRange.reduce((s, e) => s + f(e), 0);
    const r = {
      purchases: sum((e) => (e.kind === 'invoice' ? invTotal(e) : 0)),
      misc: sum((e) => (e.kind === 'pay' && !e.partyId ? num(e.amount) : 0)),
      cashOut: sum(cashOut),
      received: sum((e) => (e.kind === 'receive' ? num(e.amount) : 0)),
      charged: sum((e) => (e.kind === 'charge' ? num(e.amount) : 0)),
      count: inRange.length,
    };
    r.expense = r.purchases + r.misc;
    const add = (map, key, v) => { if (!v) return; map.set(key, (map.get(key) || 0) + v); };
    r.byCaravan = new Map(); r.allowByCaravan = new Map(); r.byHotel = new Map(); r.byCat = new Map(); r.byBrand = new Map(); r.bySupplier = new Map();
    for (const e of inRange) {
      const ex = expenseOf(e);
      add(r.byCaravan, caravan(e.caravanId)?.name || 'بدون کاروان', ex);
      if (e.kind === 'charge' && e.caravanId) add(r.allowByCaravan, caravan(e.caravanId)?.name, num(e.amount));
      add(r.byHotel, party(hotelOf(e))?.name || 'بدون هتل', ex);
      if (e.kind === 'invoice') {
        add(r.bySupplier, party(e.partyId)?.name || 'فروشنده متفرقه', invTotal(e));
        for (const l of e.lines) {
          add(r.byCat, l.cat || 'سایر', lineTotal(l));
          if (l.brand) add(r.byBrand, l.brand, lineTotal(l));
        }
      } else if (e.kind === 'pay' && !e.partyId) add(r.byCat, 'هزینه‌های متفرقه', num(e.amount));
    }
    // balances at the end of the range
    r.owe = []; r.owed = [];
    for (const [pid, b] of balances(to)) {
      const v = b[cur];
      if (Math.abs(v) < (cur === 'USD' ? 0.005 : 0.5)) continue;
      (v > 0 ? r.owe : r.owed).push([party(pid)?.name || '؟', Math.abs(v)]);
    }
    r.oweTotal = r.owe.reduce((s, [, v]) => s + v, 0);
    r.owedTotal = r.owed.reduce((s, [, v]) => s + v, 0);
    r.inRange = inRange;
    return r;
  }

  const sortedEntries = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);

  function renderReport() {
    const [from, to] = rangeOf(report.preset);
    const cur = report.cur;
    const r = computeReport(from, to, cur);
    const presets = [['today', 'امروز'], ['week', 'این هفته'], ['month', 'این ماه'], ['lastmonth', 'ماه قبل'], ['year', 'امسال'], ['all', 'همه'], ['custom', 'دلخواه']];
    const kv = (title, map, extra) => {
      const rows = sortedEntries(map);
      if (!rows.length) return '';
      return `<div class="cat-title">${title}</div><div class="row">${rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${amt(v, cur)}${extra ? extra(k, v) : ''}</b></div>`).join('')}</div>`;
    };
    let h = `<div class="chips" id="rPresets" style="grid-template-columns:repeat(auto-fill,minmax(80px,1fr));margin-bottom:10px">${presets.map(([k, n]) => `<button class="chip ${k === report.preset ? 'on' : ''}" data-r="${k}">${n}</button>`).join('')}</div>
      ${report.preset === 'custom' ? `<div class="card"><div class="field"><span class="flabel">از تاریخ</span>${dateField('rFrom', from)}</div><div class="field"><span class="flabel">تا تاریخ</span>${dateField('rTo', to)}</div><button class="btn small" id="rApply" style="width:100%">نمایش</button></div>` : ''}
      <div class="toggle" id="rCur"><button data-c="IQD" class="${cur === 'IQD' ? 'on' : ''}">دینار عراق</button><button data-c="USD" class="${cur === 'USD' ? 'on' : ''}">دلار</button></div>
      <p class="hint" style="margin:0 4px 10px">${report.preset === 'all' ? 'همه ثبت‌ها' : `از ${Core.jText(from)} تا ${Core.jText(to)}`} — ${fa(r.count)} ثبت</p>
      <div class="summary">
        <div class="stat"><div class="k">جمع هزینه‌ها</div><div class="v">${amt(r.expense, cur)}</div></div>
        <div class="stat"><div class="k">خرید با فاکتور</div><div class="v">${amt(r.purchases, cur)}</div></div>
        <div class="stat"><div class="k">پول پرداخت‌شده</div><div class="v">${amt(r.cashOut, cur)}</div></div>
        <div class="stat"><div class="k">پول دریافت‌شده</div><div class="v">${amt(r.received, cur)}</div></div>
        <div class="stat bad"><div class="k">جمع بدهی شما (تا پایان بازه)</div><div class="v">${amt(r.oweTotal, cur)}</div></div>
        <div class="stat ok"><div class="k">جمع طلب شما (تا پایان بازه)</div><div class="v">${amt(r.owedTotal, cur)}</div></div>
      </div>`;
    if (r.owe.length) h += `<div class="cat-title">به این‌ها بدهکارید</div><div class="row">${r.owe.map(([n, v]) => `<div class="kv"><span>${esc(n)}</span><b class="neg">${amt(v, cur)}</b></div>`).join('')}</div>`;
    if (r.owed.length) h += `<div class="cat-title">از این‌ها طلبکارید</div><div class="row">${r.owed.map(([n, v]) => `<div class="kv"><span>${esc(n)}</span><b class="pos">${amt(v, cur)}</b></div>`).join('')}</div>`;
    h += kv('هزینه به تفکیک کاروان', r.byCaravan, (k) => (r.allowByCaravan.has(k) ? `<br><small style="font-weight:400;color:var(--muted)">طلب ثبت‌شده (سهمیه): ${amt(r.allowByCaravan.get(k), cur)}</small>` : ''));
    h += kv('هزینه به تفکیک هتل', r.byHotel);
    h += kv('هزینه به تفکیک دسته کالا', r.byCat);
    h += kv(`خرید به تفکیک ${Core.BRAND}`, r.byBrand);
    h += kv('خرید به تفکیک فروشنده', r.bySupplier);
    if (r.misc) h += `<p class="hint">هزینه‌های متفرقه (پرداخت بدون طرف حساب): ${amt(r.misc, cur)}</p>`;
    if (!r.count && !r.owe.length && !r.owed.length) h += '<div class="empty">در این بازه ثبتی با این واحد پول وجود ندارد.</div>';
    h += `<div class="btn-row" style="margin-top:16px"><button class="btn ghost" id="rPrint">🖨 چاپ گزارش</button><button class="btn ghost" id="rCsv">📊 خروجی Excel</button></div>`;
    $('#lgBody').innerHTML = h;

    $$('#rPresets .chip').forEach((b) => (b.onclick = () => { report.preset = b.dataset.r; renderReport(); }));
    $$('#rCur button').forEach((b) => (b.onclick = () => { report.cur = b.dataset.c; renderReport(); }));
    const apply = $('#rApply');
    if (apply) apply.onclick = () => { report.from = readDate('rFrom'); report.to = readDate('rTo'); if (report.from > report.to) [report.from, report.to] = [report.to, report.from]; renderReport(); };
    $('#rPrint').onclick = () => printReport(from, to, cur, r);
    $('#rCsv').onclick = () => exportCsv(from, to);
  }

  function printReport(from, to, cur, r) {
    const table = (title, rows, col2 = 'مبلغ') => rows.length ? `<h2>${title}</h2><table><colgroup><col style="width:8%"><col style="width:62%"><col style="width:30%"></colgroup>
      <thead><tr><th>ردیف</th><th>شرح</th><th>${col2} (${CUR[cur]})</th></tr></thead>${rows.map(([k, v], i) => `<tbody class="${i % 2 ? 'alt' : ''}"><tr><td class="c">${fa(i + 1)}</td><td>${esc(k)}</td><td class="n">${fa(v, cur === 'USD' ? 2 : 0)}</td></tr></tbody>`).join('')}</table>` : '';
    const summary = [['جمع هزینه‌ها', r.expense], ['خرید با فاکتور', r.purchases], ['هزینه‌های متفرقه', r.misc], ['پول پرداخت‌شده', r.cashOut], ['پول دریافت‌شده', r.received], ['طلب‌های ثبت‌شده', r.charged], ['جمع بدهی شما (تا پایان بازه)', r.oweTotal], ['جمع طلب شما (تا پایان بازه)', r.owedTotal]];
    A().printDoc(`<h1>گزارش مالی — آشپزیار</h1>
      <p class="pmeta">${report.preset === 'all' ? 'همه ثبت‌ها' : `از ${Core.jText(from)} تا ${Core.jText(to)}`} — واحد پول: ${CUR[cur]} — تاریخ چاپ: ${Core.jText(Core.todayISO())}</p>
      ${table('خلاصه', summary)}
      ${table('بدهی‌های شما', r.owe)}
      ${table('طلب‌های شما', r.owed)}
      ${table('هزینه به تفکیک کاروان', sortedEntries(r.byCaravan))}
      ${table('هزینه به تفکیک هتل', sortedEntries(r.byHotel))}
      ${table('هزینه به تفکیک دسته کالا', sortedEntries(r.byCat))}
      ${table(`خرید به تفکیک ${Core.BRAND}`, sortedEntries(r.byBrand))}
      ${table('خرید به تفکیک فروشنده', sortedEntries(r.bySupplier))}`);
  }

  // CSV with BOM so Excel shows Persian correctly; one row per invoice line or per entry
  function exportCsv(from, to) {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['تاریخ', 'نوع', 'طرف حساب', 'کاروان', 'هتل', 'شماره فاکتور', 'قلم', Core.BRAND_TXT, 'دسته', 'مقدار', 'واحد', 'قیمت واحد', 'مبلغ', 'پرداختی', 'ارز', 'توضیح'];
    const out = [head.map(q).join(',')];
    const list = L.entries.filter((e) => e.date >= from && e.date <= to).sort((a, b) => a.date.localeCompare(b.date));
    for (const e of list) {
      const base = [Core.jShort(e.date).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)), KINDS[e.kind][1], party(e.partyId)?.name || '', caravan(e.caravanId)?.name || '', party(hotelOf(e))?.name || '', e.no || ''];
      if (e.kind === 'invoice') {
        e.lines.forEach((l, i) => out.push([...base, l.name, l.brand || '', l.cat || '', num(l.qty), l.unit, num(l.price), lineTotal(l), i === 0 ? num(e.paid) : '', CUR[e.cur], i === 0 ? e.note : ''].map(q).join(',')));
      } else {
        out.push([...base, '', '', '', '', '', '', num(e.amount), e.kind === 'pay' ? num(e.amount) : '', CUR[e.cur], e.note].map(q).join(','));
      }
    }
    const blob = new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const name = `ashpazyar-report-${from.replace(/\D/g, '').slice(0, 8) || 'all'}.csv`;
    const file = new File([blob], name, { type: 'text/csv' });
    if (navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file], title: 'گزارش مالی آشپزیار' }).catch(() => {});
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- from the shopping list result
  function invoiceFromResult(R) {
    const prices = A().prices;
    const lines = R.rows.filter((r) => !r.asNeeded && r.toBuy > 0).map((r) => {
      const o = Core.pickPrice(prices[r.id]);
      if (o && r.packs != null) return { name: r.name, itemId: r.id, cat: r.cat, brand: o.b || '', qty: r.packs, unit: 'بسته', price: num(o.price), size: num(o.size) };
      return { name: r.name, itemId: r.id, cat: r.cat, brand: '', qty: +(r.toBuy / Core.buyFactor(r.unit)).toFixed(2), unit: Core.buyUnitLabel(r.unit), price: '' };
    });
    if (!lines.length) return A().toast('در این فهرست قلمی برای خرید نیست');
    A().show('ledger');
    tab = 'entries';
    render();
    openEntry('invoice', null, { lines, note: R.plan?.name || '' });
  }

  return { render, invoiceFromResult, computeReport, balances, _L: L };
})();
window.Ledger = Ledger;
