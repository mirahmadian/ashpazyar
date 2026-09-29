// Shared logic for the user app and the admin panel
const Core = (() => {
  const MEALS = [['b', 'صبحانه'], ['l', 'ناهار'], ['d', 'شام']];

  const CAT_ORDER = ['نان', 'لبنیات', 'صبحانه', 'صبحانه گرم', 'صیفی', 'میوه', 'نوشیدنی', 'سس', 'ترشی و زیتون', 'ادویه', 'یک‌بارمصرف'];
  const catRank = (c) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? 99 : i; };
  const byCat = (a, b) => catRank(a.cat) - catRank(b.cat) || (a.cat || '').localeCompare(b.cat || '', 'fa') || a.name.localeCompare(b.name, 'fa');

  const isWeight = (unit) => unit === 'g';
  const isVolume = (unit) => unit === 'ml';
  // factor from the unit people buy in (kg / liter / count) to the base unit stored in data
  const buyFactor = (unit) => (isWeight(unit) || isVolume(unit) ? 1000 : 1);
  const buyUnitLabel = (unit) => (isWeight(unit) ? 'کیلو' : isVolume(unit) ? 'لیتر' : unit);
  const packAdj = (unit) => (isWeight(unit) ? 'کیلویی' : isVolume(unit) ? 'لیتری' : /[اوه]$/.test(unit) ? unit + '‌ای' : unit + 'ی');

  // ---------- numbers
  const fa = (n, digits = 0) =>
    Number(n || 0).toLocaleString('fa-IR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  const toEnDigits = (s) =>
    String(s ?? '')
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/[٬,\s]/g, '')
      .replace(/[٫\/]/g, '.');
  const num = (s) => {
    const v = parseFloat(toEnDigits(s));
    return Number.isFinite(v) ? v : 0;
  };
  const money = (n) => fa(Math.round(n)) + ' دینار';

  // amount in base unit -> readable text
  function qtyText(amount, unit) {
    if (isWeight(unit)) return amount >= 1000 ? fa(amount / 1000, 2) + ' کیلو' : fa(amount, 0) + ' گرم';
    if (isVolume(unit)) return amount >= 1000 ? fa(amount / 1000, 2) + ' لیتر' : fa(amount, 0) + ' میلی‌لیتر';
    return fa(Math.ceil(amount - 1e-9)) + ' ' + unit;
  }

  // ---------- prices: each item may have several brand (ویژند) options; one is selected for calculations
  // stored shape: { sel: index, list: [{ b: brand, size, price, at }] }  (old shape {size, price, at} is migrated)
  function normPrice(p) {
    if (!p) return null;
    if (Array.isArray(p.list)) return p;
    if (num(p.size) > 0 && num(p.price) > 0) return { sel: 0, list: [{ b: '', size: p.size, price: p.price, at: p.at }] };
    return null;
  }
  const validOpt = (o) => o && num(o.size) > 0 && num(o.price) > 0;
  function pickPrice(p) {
    const n = normPrice(p);
    if (!n) return null;
    if (validOpt(n.list[n.sel])) return n.list[n.sel];
    return n.list.find(validOpt) || null;
  }
  const BRAND = 'ویژند <small class="brand-en">(برند)</small>';
  const BRAND_TXT = 'ویژند (برند)';
  const OFFICIAL = 'قیمت مصوب دفتر نمایندگی';

  // share code for prices sent from a user to the office: '#ASHP1:' + base64(UTF-8 JSON)
  const PRICE_CODE = '#ASHP1:';
  function encodePrices(list) {
    const bytes = new TextEncoder().encode(JSON.stringify(list));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return PRICE_CODE + btoa(bin);
  }
  function decodePrices(text) {
    const m = String(text).match(/#ASHP1:([A-Za-z0-9+/=\s]+)/);
    if (!m) return null;
    try {
      const bin = atob(m[1].replace(/\s+/g, ''));
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    } catch { return null; }
  }

  // ---------- Jalali (Persian) calendar; dates are stored as local 'YYYY-MM-DD' (Gregorian)
  function g2j(gy, gm, gd) {
    const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let jy;
    if (gy > 1600) { jy = 979; gy -= 1600; } else { jy = 0; gy -= 621; }
    const gy2 = gm > 2 ? gy + 1 : gy;
    let days = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + gdm[gm - 1];
    jy += 33 * Math.floor(days / 12053); days %= 12053;
    jy += 4 * Math.floor(days / 1461); days %= 1461;
    if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
    const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
    const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
    return [jy, jm, jd];
  }
  function j2g(jy, jm, jd) {
    let gy;
    if (jy > 979) { gy = 1600; jy -= 979; } else { gy = 621; }
    let days = 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + 78 + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
    gy += 400 * Math.floor(days / 146097); days %= 146097;
    if (days > 36524) { gy += 100 * Math.floor(--days / 36524); days %= 36524; if (days >= 365) days++; }
    gy += 4 * Math.floor(days / 1461); days %= 1461;
    if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
    let gd = days + 1;
    const sal = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let gm;
    for (gm = 0; gm < 13; gm++) { if (gd <= sal[gm]) break; gd -= sal[gm]; }
    return [gy, gm, gd];
  }
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (gy, gm, gd) => `${gy}-${pad(gm)}-${pad(gd)}`;
  const todayISO = () => { const d = new Date(); return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
  const isoToJ = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return g2j(y, m, d); };
  const jToIso = (jy, jm, jd) => isoOf(...j2g(jy, jm, jd));
  const jMonthLen = (jy, jm) => (jm <= 6 ? 31 : jm <= 11 ? 30 : isoToJ(jToIso(jy, 12, 30))[1] === 12 ? 30 : 29);
  const J_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  const faN = (n) => Number(n).toLocaleString('fa-IR', { useGrouping: false });
  const jText = (iso) => { const [y, m, d] = isoToJ(iso); return `${faN(d)} ${J_MONTHS[m - 1]} ${faN(y)}`; };
  const jShort = (iso) => { const [y, m, d] = isoToJ(iso); return `${faN(y)}/${faN(m).padStart(2, '۰')}/${faN(d).padStart(2, '۰')}`; };

  // ---------- menu expansion
  const share = (e) => (e.q == null ? null : e.q * (e.p == null ? 100 : e.p) / 100);

  // returns Map itemId -> { perPerson (base unit, per day-set), asNeeded }
  function perPersonNeeds(data, plan, dayIdxs) {
    const out = new Map();
    const add = (id, amount) => {
      const cur = out.get(id) || { perPerson: 0, asNeeded: false };
      if (amount == null) cur.asNeeded = true;
      else cur.perPerson += amount;
      out.set(id, cur);
    };
    for (const di of dayIdxs) {
      const day = plan.days[di];
      if (!day) continue;
      for (const [m] of MEALS) {
        for (const e of day[m]?.e || []) {
          const s = share(e);
          if (e.i) add(e.i, s);
          else if (e.r) {
            const rec = data.recipes[e.r];
            if (!rec) continue;
            for (const g of rec.ing) add(g.i, s == null || g.q == null ? null : s * g.q);
          }
        }
      }
    }
    return out;
  }

  // prices: { id: {size (buy unit), price} }, stock: { id: amount (buy unit) }
  function calculate({ data, plan, dayIdxs, pilgrims, prices = {}, stock = {}, rate = 0, groupId }) {
    const needs = perPersonNeeds(data, plan, dayIdxs);
    const rows = [];
    let useCost = 0, buyCost = 0, missing = 0;
    for (const [id, n] of needs) {
      const item = data.items[id];
      if (!item) continue;
      const f = buyFactor(item.unit);
      const counted = !isWeight(item.unit) && !isVolume(item.unit);
      let need = n.perPerson * pilgrims;
      if (counted) need = Math.ceil(need - 1e-9);
      const row = { id, name: item.name, cat: item.cat || 'سایر', unit: item.unit, need, asNeeded: n.asNeeded && need === 0 };
      const st = Math.max(0, num(stock[id]) * f);
      row.stock = st;
      row.toBuy = Math.max(0, need - st);
      const pr = pickPrice(prices[id]);
      if (pr) {
        row.brand = pr.b || '';
        const sizeBase = num(pr.size) * f;
        row.unitPrice = num(pr.price) / sizeBase; // per base unit
        row.packs = Math.ceil(row.toBuy / sizeBase - 1e-9);
        row.packSize = num(pr.size);
        row.useCost = need * row.unitPrice;
        row.buyCost = row.packs * num(pr.price);
        row.leftover = st + row.packs * sizeBase - need;
        useCost += row.useCost;
        buyCost += row.buyCost;
      } else {
        row.leftover = Math.max(0, st - need);
        if (need > 0) missing++;
      }
      rows.push(row);
    }
    rows.sort(byCat);
    const group = data.groups.find((g) => g.id === groupId);
    const budgetDays = dayIdxs.filter((i) => plan.days[i] && !plan.days[i].extra).length;
    const budgetUsd = group ? group.usd * pilgrims * budgetDays : 0;
    return { rows, useCost, buyCost, missing, budgetUsd, budget: budgetUsd * rate, budgetDays };
  }

  // total amount of each hot-breakfast recipe for the cook
  function recipeTotals(data, plan, dayIdxs, pilgrims) {
    const out = [];
    for (const di of dayIdxs) {
      const day = plan.days[di];
      for (const [m, mName] of MEALS) {
        for (const e of day?.[m]?.e || []) {
          if (!e.r || !data.recipes[e.r]) continue;
          const rec = data.recipes[e.r];
          const s = share(e) ?? 1;
          out.push({
            day: day.name, meal: mName, name: rec.name, method: rec.method,
            ing: rec.ing.map((g) => ({ name: data.items[g.i]?.name || g.i, unit: data.items[g.i]?.unit, total: g.q == null ? null : g.q * s * pilgrims })),
          });
        }
      }
    }
    return out;
  }

  function entryLabel(data, e) {
    const src = e.i ? data.items[e.i] : data.recipes[e.r];
    return src ? src.name : '؟';
  }

  // ---------- storage (safe)
  const store = {
    get(key, def) {
      try { const v = localStorage.getItem(key); return v == null ? def : JSON.parse(v); } catch { return def; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
    },
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const faDate = (iso, opts = { year: 'numeric', month: 'long', day: 'numeric' }) => {
    try { return new Date(iso).toLocaleDateString('fa-IR-u-ca-persian', opts); } catch { return iso; }
  };
  const faMonthKey = (iso) => {
    try {
      const p = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: 'numeric' }).formatToParts(new Date(iso));
      const y = p.find((x) => x.type === 'year').value, m = p.find((x) => x.type === 'month').value;
      return `${y}-${String(m).padStart(2, '0')}`;
    } catch { return iso.slice(0, 7); }
  };

  // ---------- day / night theme (day is the default)
  function initTheme() {
    const btn = document.getElementById('themeBtn');
    const apply = (t) => {
      if (t === 'dark') document.documentElement.dataset.theme = 'dark';
      else delete document.documentElement.dataset.theme;
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#1d2524' : '#0f766e');
      if (btn) {
        btn.textContent = t === 'dark' ? '☀️ روز' : '🌙 شب';
        btn.title = t === 'dark' ? 'رفتن به حالت روز' : 'رفتن به حالت شب';
      }
    };
    let theme = store.get('ash.theme', 'light') === 'dark' ? 'dark' : 'light';
    apply(theme);
    if (btn) btn.onclick = () => { theme = theme === 'dark' ? 'light' : 'dark'; store.set('ash.theme', theme); apply(theme); };
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTheme);
    else initTheme();
  }

  return { MEALS, byCat, normPrice, pickPrice, BRAND, BRAND_TXT, OFFICIAL, encodePrices, decodePrices, g2j, j2g, todayISO, isoToJ, jToIso, jMonthLen, J_MONTHS, jText, jShort, faN, isWeight, isVolume, buyFactor, buyUnitLabel, packAdj, fa, num, toEnDigits, money, qtyText, perPersonNeeds, calculate, recipeTotals, entryLabel, store, esc, faDate, faMonthKey };
})();
