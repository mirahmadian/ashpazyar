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
      const pr = prices[id];
      if (pr && num(pr.size) > 0 && num(pr.price) > 0) {
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

  return { MEALS, byCat, isWeight, isVolume, buyFactor, buyUnitLabel, packAdj, fa, num, toEnDigits, money, qtyText, perPersonNeeds, calculate, recipeTotals, entryLabel, store, esc, faDate, faMonthKey };
})();
