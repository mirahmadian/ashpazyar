(() => {
  const { fa, num, money, qtyText, esc, store, buyFactor, buyUnitLabel, isWeight, isVolume } = Core;
  const $ = (s) => document.querySelector(s);

  const K = { data: 'ash.data', settings: 'ash.settings', prices: 'ash.prices', stock: 'ash.stock', history: 'ash.history' };
  let data = store.get(K.data, null);
  const settings = Object.assign({ group: null, planId: null, days: [], pilgrims: 50, rate: '' }, store.get(K.settings, {}));
  let prices = store.get(K.prices, {});
  let stock = store.get(K.stock, {});
  let history = store.get(K.history, []);
  let lastResult = null;

  const saveSettings = () => store.set(K.settings, settings);

  // ---------- toast & sheet
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
  }
  function openSheet(html) {
    $('#sheet').innerHTML = html;
    $('#sheet').classList.add('on');
    $('#sheetBg').classList.add('on');
  }
  function closeSheet() {
    $('#sheet').classList.remove('on');
    $('#sheetBg').classList.remove('on');
  }
  $('#sheetBg').onclick = closeSheet;

  // ---------- navigation
  const TITLES = {
    calc: ['آشپزیار', 'محاسبه خرید دورچین کاروان'],
    result: ['فهرست خرید', ''],
    menu: ['منوی برنامه', ''],
    prices: ['قیمت اقلام', 'قیمت خرید عمده را وارد کنید'],
    stock: ['موجودی انبار', 'آنچه از قبل دارید'],
    history: ['سابقه خریدها', 'هزینه‌های ثبت‌شده روی این گوشی'],
  };
  let current = 'calc';
  function show(name, sub) {
    current = name;
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === 'scr-' + name));
    const [t, st] = TITLES[name];
    $('#title').textContent = t;
    $('#subtitle').textContent = sub ?? st;
    const isSub = name === 'result' || name === 'menu';
    $('#topbar').classList.toggle('has-back', isSub);
    const tab = isSub ? 'calc' : name;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    window.scrollTo(0, 0);
    if (name === 'prices') renderPrices();
    if (name === 'stock') renderStock();
    if (name === 'history') renderHistory();
  }
  function openSub(name, sub) {
    history_push();
    show(name, sub);
  }
  function history_push() {
    try { window.history.pushState({ sub: true }, ''); } catch {}
  }
  window.addEventListener('popstate', () => {
    if ($('#sheet').classList.contains('on')) return closeSheet();
    if (current === 'result' || current === 'menu') show('calc');
  });
  $('#backBtn').onclick = () => window.history.back();
  document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => show(b.dataset.tab)));

  // ---------- data loading
  async function loadData() {
    try {
      const r = await fetch('data/menus.json', { cache: 'no-cache' });
      if (!r.ok) throw 0;
      const fresh = await r.json();
      const changed = data && (data.updated !== fresh.updated || data.version !== fresh.version);
      data = fresh;
      store.set(K.data, data);
      if (changed) toast('برنامه‌های غذایی به‌روز شد ✅');
    } catch {
      // opened as a local file or offline: fall back to the built-in copy if it is newer
      const builtIn = window.ASH_DATA;
      if (builtIn && (!data || (builtIn.version || 0) > (data.version || 0))) {
        data = builtIn;
        store.set(K.data, data);
      }
      if (!data) {
        $('#scr-calc').innerHTML = '<div class="empty"><div class="big">📡</div>فایل برنامه‌های غذایی پیدا نشد.<br><button class="btn" onclick="location.reload()" style="margin-top:16px">تلاش دوباره</button></div>';
        return false;
      }
    }
    return true;
  }

  // ---------- calc screen
  const activePlans = () => data.plans.filter((p) => p.active !== false && p.groups?.includes(settings.group));
  const currentPlan = () => data.plans.find((p) => p.id === settings.planId);
  const currentGroup = () => data.groups.find((g) => g.id === settings.group);

  function renderGroups() {
    $('#groupChips').innerHTML = data.groups
      .map((g) => `<button class="chip ${g.id === settings.group ? 'on' : ''}" data-g="${esc(g.id)}">${esc(g.name)}<small>${fa(g.usd, 2)} دلار</small></button>`)
      .join('');
    $('#groupChips').querySelectorAll('.chip').forEach((b) => (b.onclick = () => {
      settings.group = b.dataset.g;
      saveSettings();
      renderCalc();
    }));
    const g = currentGroup();
    $('#groupHint').textContent = g ? `سهم دورچین این گروه: ${fa(g.usd, 2)} دلار برای هر زائر در هر روز` : 'گروه هتل خود را انتخاب کنید.';
  }

  function renderPlans() {
    const plans = settings.group ? activePlans() : [];
    if (!plans.find((p) => p.id === settings.planId)) {
      settings.planId = plans[0]?.id || null;
      settings.days = [];
    }
    $('#planList').innerHTML = !settings.group
      ? '<p class="hint">اول گروه هتل را انتخاب کنید.</p>'
      : plans.length
        ? plans.map((p) => `<button class="opt ${p.id === settings.planId ? 'on' : ''}" data-p="${esc(p.id)}"><span class="dot"></span><span>${esc(p.name)}</span></button>`).join('')
        : '<p class="hint">برای این گروه هنوز برنامه‌ای تعریف نشده است.</p>';
    $('#planList').querySelectorAll('.opt').forEach((b) => (b.onclick = () => {
      settings.planId = b.dataset.p;
      settings.days = [];
      saveSettings();
      renderCalc();
    }));
    $('#viewMenuBtn').style.display = currentPlan() ? '' : 'none';
  }

  function renderDays() {
    const plan = currentPlan();
    if (!plan) { $('#dayChips').innerHTML = ''; $('#allDaysBtn').style.display = 'none'; return; }
    settings.days = settings.days.filter((i) => i < plan.days.length);
    $('#allDaysBtn').style.display = '';
    $('#dayChips').innerHTML = plan.days
      .map((d, i) => `<button class="chip ${settings.days.includes(i) ? 'on' : ''}" data-d="${i}">${esc(d.name)}${d.b?.title && !d.extra ? `<small>${esc(d.b.title)}</small>` : ''}</button>`)
      .join('');
    $('#dayChips').querySelectorAll('.chip').forEach((b) => (b.onclick = () => {
      const i = +b.dataset.d;
      settings.days = settings.days.includes(i) ? settings.days.filter((x) => x !== i) : [...settings.days, i].sort((a, b) => a - b);
      saveSettings();
      renderDays();
    }));
  }
  $('#allDaysBtn').onclick = () => {
    const plan = currentPlan();
    if (!plan) return;
    settings.days = plan.days.map((d, i) => (d.extra ? -1 : i)).filter((i) => i >= 0);
    saveSettings();
    renderDays();
  };

  function renderCalc() {
    renderGroups();
    renderPlans();
    renderDays();
    saveSettings();
  }

  const pil = $('#pilgrims');
  pil.value = fa(settings.pilgrims);
  const setPil = (v) => { settings.pilgrims = Math.max(1, Math.round(v)); pil.value = fa(settings.pilgrims); saveSettings(); };
  $('#pMinus').onclick = () => setPil(num(pil.value) - 1);
  $('#pPlus').onclick = () => setPil(num(pil.value) + 1);
  pil.onchange = () => setPil(num(pil.value) || 1);
  pil.onfocus = () => pil.select();

  const rate = $('#rate');
  rate.value = settings.rate ? fa(settings.rate) : '';
  rate.onchange = () => { settings.rate = num(rate.value); rate.value = settings.rate ? fa(settings.rate) : ''; saveSettings(); };

  $('#calcBtn').onclick = () => {
    settings.pilgrims = Math.max(1, num(pil.value));
    settings.rate = num(rate.value);
    saveSettings();
    if (!settings.group) return toast('گروه هتل را انتخاب کنید');
    if (!currentPlan()) return toast('برنامه غذایی را انتخاب کنید');
    if (!settings.days.length) return toast('حداقل یک روز را انتخاب کنید');
    runCalc();
    openSub('result', `${fa(settings.pilgrims)} زائر — ${settings.days.length === 1 ? currentPlan().days[settings.days[0]].name : fa(settings.days.length) + ' روز'}`);
  };

  // ---------- result
  function runCalc() {
    const plan = currentPlan();
    lastResult = Core.calculate({ data, plan, dayIdxs: settings.days, pilgrims: settings.pilgrims, prices, stock, rate: settings.rate, groupId: settings.group });
    lastResult.plan = plan;
    lastResult.recipes = Core.recipeTotals(data, plan, settings.days, settings.pilgrims);
    renderResult();
  }

  function rowHtml(r) {
    if (r.asNeeded) return `<div class="row"><div class="top"><span class="name">${esc(r.name)}</span><span class="cost" style="color:var(--muted);font-weight:400">به مقدار لازم</span></div></div>`;
    const hasPrice = r.unitPrice != null;
    const meta = [`لازم: <b>${qtyText(r.need, r.unit)}</b>`];
    if (r.stock > 0) meta.push(`موجودی: ${qtyText(r.stock, r.unit)}`);
    if (r.toBuy <= 0) meta.push('<span class="buy">✔ نیازی به خرید نیست</span>');
    else if (hasPrice) meta.push(`<span class="buy">بخرید: ${fa(r.packs)} بسته ${fa(r.packSize, 2)} ${Core.packAdj(r.unit)}</span>`);
    else if (r.stock > 0) meta.push(`<span class="buy">بخرید: ${qtyText(r.toBuy, r.unit)}</span>`);
    return `<div class="row ${hasPrice ? '' : 'nop'} tap" data-id="${esc(r.id)}">
      <div class="top"><span class="name">${esc(r.name)}</span><span class="cost">${hasPrice ? money(r.useCost) : 'قیمت ندارد ✎'}</span></div>
      <div class="meta">${meta.join('')}</div></div>`;
  }

  function renderResult() {
    const R = lastResult;
    const plan = R.plan;
    const g = currentGroup();
    let html = '';
    if (R.missing) html += `<div class="banner warn">قیمت ${fa(R.missing)} قلم وارد نشده؛ روی آن قلم بزنید تا قیمتش را وارد کنید.</div>`;

    html += '<div class="summary">';
    html += `<div class="stat"><div class="k">هزینه مصرف این روزها</div><div class="v">${money(R.useCost)}</div></div>`;
    html += `<div class="stat"><div class="k">هزینه برای هر زائر در روز</div><div class="v">${R.budgetDays ? money(R.useCost / settings.pilgrims / R.budgetDays) : '—'}</div></div>`;
    if (R.budget > 0) {
      const diff = R.budget - R.useCost;
      html += `<div class="stat"><div class="k">سهمیه مجاز (${fa(g.usd, 2)}$ × ${fa(settings.pilgrims)} × ${fa(R.budgetDays)} روز)</div><div class="v">${money(R.budget)}</div></div>`;
      html += `<div class="stat ${diff >= 0 ? 'ok' : 'bad'}"><div class="k">${diff >= 0 ? 'زیر سهمیه ✅' : 'بیشتر از سهمیه ⚠️'}</div><div class="v">${money(Math.abs(diff))}</div></div>`;
    } else if (R.budgetUsd > 0) {
      html += `<div class="stat wide"><div class="k">سهمیه مجاز</div><div class="v">${fa(R.budgetUsd, 2)} دلار</div><div class="k">برای تبدیل به دینار، نرخ دلار را در صفحه قبل وارد کنید.</div></div>`;
    }
    html += `<div class="stat wide"><div class="k">پولی که برای خرید لازم دارید (با بسته‌های کامل و کسر موجودی)</div><div class="v">${money(R.buyCost)}</div></div>`;
    html += '</div>';

    const buyRows = R.rows.filter((r) => !r.asNeeded);
    let cat = null;
    for (const r of buyRows) {
      if (r.cat !== cat) { cat = r.cat; html += `<div class="cat-title">${esc(cat)}</div>`; }
      html += rowHtml(r);
    }
    const asNeeded = R.rows.filter((r) => r.asNeeded);
    if (asNeeded.length) {
      html += '<div class="cat-title">به مقدار لازم</div>';
      html += `<div class="row"><div class="meta">${asNeeded.map((r) => esc(r.name)).join('، ')}</div></div>`;
    }

    if (R.recipes.length) {
      html += '<div class="cat-title">صبحانه گرم و سالادها — مقدار کل برای آشپز</div>';
      for (const rc of R.recipes) {
        html += `<div class="card recipe"><h2>${esc(rc.name)} <small style="font-weight:400;color:var(--muted)">(${esc(rc.day)})</small></h2><ul class="ing">`;
        html += rc.ing.map((i) => `<li><span>${esc(i.name)}</span><b>${i.total == null ? 'به مقدار لازم' : qtyText(i.total, i.unit)}</b></li>`).join('');
        html += `</ul>${rc.method ? `<p>${esc(rc.method)}</p>` : ''}</div>`;
      }
    }

    html += `<div class="no-print" style="margin-top:16px">
      <button class="btn" id="saveBtn">💾 ثبت در سابقه</button>
      <div class="btn-row">
        <button class="btn ghost" id="shareBtn">📲 ارسال فهرست</button>
        <button class="btn ghost" id="printBtn">🖨 چاپ</button>
      </div></div>`;
    $('#scr-result').innerHTML = html;

    $('#scr-result').querySelectorAll('.row.tap').forEach((el) => (el.onclick = () => openPriceSheet(el.dataset.id, () => runCalc())));
    $('#saveBtn').onclick = openSaveSheet;
    $('#shareBtn').onclick = shareList;
    $('#printBtn').onclick = () => window.print();
  }

  function listText() {
    const R = lastResult;
    const days = settings.days.map((i) => R.plan.days[i].name).join('، ');
    let t = `🧾 فهرست خرید دورچین\n${R.plan.name}\n${days}\nتعداد زائر: ${fa(settings.pilgrims)}\n\n`;
    for (const r of R.rows) {
      if (r.asNeeded || r.toBuy <= 0) continue;
      t += `▫️ ${r.name}: ${r.packs != null ? `${fa(r.packs)} بسته (${qtyText(r.toBuy, r.unit)})` : qtyText(r.toBuy, r.unit)}\n`;
    }
    t += `\n💰 مبلغ خرید: ${money(R.buyCost)}\n📊 هزینه مصرف: ${money(R.useCost)}`;
    if (R.budget > 0) t += `\n🎯 سهمیه مجاز: ${money(R.budget)}`;
    t += '\n\n— آشپزیار';
    return t;
  }
  async function shareList() {
    const text = listText();
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); toast('فهرست کپی شد؛ در پیام‌رسان بچسبانید'); }
    catch { window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank'); }
  }

  function openSaveSheet() {
    openSheet(`<h3>ثبت در سابقه</h3>
      <label class="field"><span>یادداشت (اختیاری) — مثلاً نام هتل یا کاروان</span><input id="saveNote" placeholder="مثلاً هتل الکوثر — کاروان ۱۲"></label>
      <label class="check"><input type="checkbox" id="saveStock" checked><span>باقی‌مانده این خرید را به‌عنوان «موجودی انبار» ذخیره کن تا دفعه بعد کمتر بخرم.<br><small style="color:var(--muted)">بعداً می‌توانید در صفحه موجودی اصلاحش کنید.</small></span></label>
      <button class="btn" id="saveOk">ثبت کن</button>
      <button class="link" style="width:100%" id="saveCancel">انصراف</button>`);
    $('#saveCancel').onclick = closeSheet;
    $('#saveOk').onclick = () => {
      const R = lastResult;
      const g = currentGroup();
      history.unshift({
        id: Date.now().toString(36),
        date: new Date().toISOString(),
        note: $('#saveNote').value.trim(),
        plan: R.plan.name,
        group: g?.name,
        days: settings.days.map((i) => R.plan.days[i].name),
        pilgrims: settings.pilgrims,
        useCost: R.useCost, buyCost: R.buyCost, budget: R.budget,
        rows: R.rows.filter((r) => !r.asNeeded).map((r) => ({ n: r.name, u: r.unit, need: r.need, buy: r.toBuy, packs: r.packs, cost: r.buyCost || 0 })),
      });
      store.set(K.history, history);
      if ($('#saveStock').checked) {
        for (const r of R.rows) {
          if (r.asNeeded) continue;
          const left = Math.max(0, r.leftover || 0) / buyFactor(r.unit);
          if (left > 0) stock[r.id] = +left.toFixed(3); else delete stock[r.id];
        }
        store.set(K.stock, stock);
      }
      closeSheet();
      toast('در سابقه ثبت شد ✅');
    };
  }

  // ---------- menu view
  $('#viewMenuBtn').onclick = () => {
    const plan = currentPlan();
    if (!plan) return;
    let html = plan.note ? `<div class="banner info">${esc(plan.note)}</div>` : '';
    for (const d of plan.days) {
      html += `<div class="card day"><h3>${esc(d.name)}</h3>`;
      for (const [m, mName] of Core.MEALS) {
        const meal = d[m];
        if (!meal) continue;
        html += `<div class="meal"><b>${mName}: ${esc(meal.title || '')}</b><div class="items">${(meal.e || [])
          .map((e) => {
            const pct = e.p != null && e.p !== 100 ? ` (${fa(e.p)}٪)` : '';
            return esc(Core.entryLabel(data, e)) + pct;
          })
          .join(' – ')}</div></div>`;
      }
      html += '</div>';
    }
    $('#scr-menu').innerHTML = html;
    openSub('menu', plan.name);
  };

  // ---------- prices
  let priceScope = 'plan';
  document.querySelectorAll('#priceScope button').forEach((b) => (b.onclick = () => {
    priceScope = b.dataset.s;
    document.querySelectorAll('#priceScope button').forEach((x) => x.classList.toggle('on', x === b));
    renderPrices();
  }));
  $('#priceSearch').oninput = () => renderPrices();

  function planItemIds() {
    const plan = currentPlan();
    if (!plan) return null;
    return [...Core.perPersonNeeds(data, plan, plan.days.map((_, i) => i)).entries()]
      .filter(([, n]) => n.perPerson > 0)
      .map(([id]) => id);
  }
  function itemList(scope, q) {
    let ids = scope === 'plan' ? planItemIds() : null;
    if (!ids) ids = Object.keys(data.items);
    return ids
      .map((id) => ({ id, ...data.items[id] }))
      .filter((it) => it.name && (!q || it.name.includes(q)))
      .sort(Core.byCat);
  }

  function priceMeta(id) {
    const it = data.items[id];
    const p = prices[id];
    if (!p || !num(p.size) || !num(p.price)) return null;
    const bu = buyUnitLabel(it.unit);
    const unitP = num(p.price) / num(p.size);
    return `بسته ${fa(p.size, 3)} ${Core.packAdj(it.unit)}: ${money(p.price)} — هر ${bu}: <b>${money(unitP)}</b>`;
  }

  function renderPrices() {
    if (!data) return;
    const list = itemList(priceScope, $('#priceSearch').value.trim());
    let html = '', cat = null;
    for (const it of list) {
      if (it.cat !== cat) { cat = it.cat; html += `<div class="cat-title">${esc(cat || 'سایر')}</div>`; }
      const m = priceMeta(it.id);
      html += `<div class="row tap ${m ? '' : 'nop'}" data-id="${esc(it.id)}"><div class="top"><span class="name">${esc(it.name)}</span><span class="cost">${m ? '✎' : 'وارد نشده ✎'}</span></div>${m ? `<div class="meta">${m}</div>` : ''}</div>`;
    }
    $('#priceList').innerHTML = html || '<div class="empty">موردی پیدا نشد.</div>';
    $('#priceList').querySelectorAll('.row').forEach((el) => (el.onclick = () => openPriceSheet(el.dataset.id, renderPrices)));
  }

  function openPriceSheet(id, after) {
    const it = data.items[id];
    const bu = buyUnitLabel(it.unit);
    const p = prices[id] || {};
    const example = isWeight(it.unit) ? 'مثلاً کیسه ۱۰ کیلویی ← بنویسید ۱۰' : isVolume(it.unit) ? 'مثلاً گالن ۴ لیتری ← بنویسید ۴' : 'مثلاً باکس ۳۰ عددی ← بنویسید ۳۰';
    openSheet(`<h3>${esc(it.name)}</h3>
      <label class="field"><span>هر بسته/باکس چند ${bu} است؟ <small>(${example})</small></span>
        <div class="suffix"><input id="pSize" inputmode="decimal" value="${p.size ? fa(p.size, 3) : ''}"><em>${bu}</em></div></label>
      <label class="field"><span>قیمت کل همان بسته</span>
        <div class="suffix"><input id="pPrice" inputmode="numeric" value="${p.price ? fa(p.price) : ''}"><em>دینار</em></div></label>
      <div class="calc" id="pCalc">—</div>
      <button class="btn" id="pSave">ذخیره قیمت</button>
      ${p.price ? '<button class="link" style="width:100%;color:var(--bad)" id="pDel">حذف قیمت</button>' : ''}`);
    const upd = () => {
      const s = num($('#pSize').value), pr = num($('#pPrice').value);
      $('#pCalc').textContent = s > 0 && pr > 0 ? `قیمت هر ${bu}: ${money(pr / s)}` : 'اندازه و قیمت بسته را بنویسید';
    };
    $('#pSize').oninput = upd;
    $('#pPrice').oninput = upd;
    upd();
    setTimeout(() => $('#pSize').focus(), 250);
    $('#pSave').onclick = () => {
      const s = num($('#pSize').value), pr = num($('#pPrice').value);
      if (!(s > 0 && pr > 0)) return toast('اندازه و قیمت را کامل بنویسید');
      prices[id] = { size: s, price: pr, at: new Date().toISOString() };
      store.set(K.prices, prices);
      closeSheet();
      toast('قیمت ذخیره شد');
      after?.();
    };
    const del = $('#pDel');
    if (del) del.onclick = () => { delete prices[id]; store.set(K.prices, prices); closeSheet(); after?.(); };
  }

  // ---------- stock
  $('#stockSearch').oninput = () => renderStock();
  function renderStock() {
    if (!data) return;
    const list = itemList('plan', $('#stockSearch').value.trim());
    let html = '', cat = null;
    for (const it of list) {
      if (it.cat !== cat) { cat = it.cat; html += `<div class="cat-title">${esc(cat || 'سایر')}</div>`; }
      const v = stock[it.id];
      html += `<div class="row stockrow"><span class="name">${esc(it.name)}</span>
        <div class="suffix"><input data-id="${esc(it.id)}" inputmode="decimal" placeholder="۰" value="${v ? fa(v, 3) : ''}"><em>${buyUnitLabel(it.unit)}</em></div></div>`;
    }
    $('#stockList').innerHTML = html || '<div class="empty">اول در صفحه محاسبه، گروه هتل و برنامه را انتخاب کنید.</div>';
    $('#stockList').querySelectorAll('input').forEach((inp) => {
      inp.onfocus = () => inp.select();
      inp.onchange = () => {
        const v = num(inp.value);
        if (v > 0) stock[inp.dataset.id] = v; else delete stock[inp.dataset.id];
        inp.value = v > 0 ? fa(v, 3) : '';
        store.set(K.stock, stock);
        toast('موجودی ذخیره شد');
      };
    });
  }
  $('#clearStock').onclick = () => {
    if (!confirm('همه موجودی‌ها صفر شوند؟')) return;
    stock = {};
    store.set(K.stock, stock);
    renderStock();
  };

  // ---------- history
  function renderHistory() {
    if (!history.length) {
      $('#historyList').innerHTML = '<div class="empty"><div class="big">🗂</div>هنوز چیزی ثبت نشده.<br>بعد از محاسبه، دکمه «ثبت در سابقه» را بزنید.</div>';
      return;
    }
    const months = new Map();
    for (const h of history) {
      const k = Core.faMonthKey(h.date);
      if (!months.has(k)) months.set(k, []);
      months.get(k).push(h);
    }
    let html = '';
    for (const [, list] of months) {
      const buy = list.reduce((s, h) => s + h.buyCost, 0);
      const use = list.reduce((s, h) => s + h.useCost, 0);
      html += `<div class="month"><div>${Core.faDate(list[0].date, { year: 'numeric', month: 'long' })} — ${fa(list.length)} مورد</div>
        <div class="v">خرید: ${money(buy)}</div><div style="font-size:14px;opacity:.9">هزینه مصرف: ${money(use)}</div></div>`;
      for (const h of list) {
        html += `<div class="row tap" data-h="${esc(h.id)}"><div class="top"><span class="name">${esc(h.note || h.plan)}</span><span class="cost">${money(h.buyCost)}</span></div>
          <div class="meta"><span>${Core.faDate(h.date)}</span><span>${fa(h.pilgrims)} زائر</span><span>${esc(h.days.join('، '))}</span>${h.group ? `<span>گروه ${esc(h.group)}</span>` : ''}</div></div>`;
      }
    }
    $('#historyList').innerHTML = html;
    $('#historyList').querySelectorAll('.row').forEach((el) => (el.onclick = () => openHistory(el.dataset.h)));
  }
  function openHistory(id) {
    const h = history.find((x) => x.id === id);
    if (!h) return;
    const rows = h.rows.filter((r) => r.buy > 0)
      .map((r) => `<li><span>${esc(r.n)}: ${qtyText(r.buy, r.u)}${r.packs != null ? ` (${fa(r.packs)} بسته)` : ''}</span><b>${r.cost ? money(r.cost) : '—'}</b></li>`).join('');
    openSheet(`<h3>${esc(h.note || h.plan)}</h3>
      <div class="meta" style="color:var(--muted);font-size:14px">${Core.faDate(h.date)} — ${esc(h.plan)}<br>${fa(h.pilgrims)} زائر — ${esc(h.days.join('، '))}</div>
      <div class="summary" style="margin-top:12px">
        <div class="stat"><div class="k">مبلغ خرید</div><div class="v">${money(h.buyCost)}</div></div>
        <div class="stat"><div class="k">هزینه مصرف</div><div class="v">${money(h.useCost)}</div></div>
      </div>
      <div class="recipe"><ul class="ing">${rows || '<li>خریدی لازم نبود</li>'}</ul></div>
      <button class="btn danger" id="hDel" style="margin-top:12px">حذف از سابقه</button>`);
    $('#hDel').onclick = () => {
      if (!confirm('این مورد حذف شود؟')) return;
      history = history.filter((x) => x.id !== id);
      store.set(K.history, history);
      closeSheet();
      renderHistory();
    };
  }

  $('#backupBtn').onclick = async () => {
    const blob = new Blob([JSON.stringify({ app: 'ashpazyar', at: new Date().toISOString(), settings, prices, stock, history }, null, 1)], { type: 'application/json' });
    const name = `ashpazyar-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'پشتیبان آشپزیار' }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#restoreBtn').onclick = () => $('#restoreFile').click();
  $('#restoreFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const b = JSON.parse(await f.text());
      if (b.app !== 'ashpazyar') throw 0;
      if (!confirm('اطلاعات فعلی این گوشی با فایل پشتیبان جایگزین شود؟')) return;
      prices = b.prices || {}; stock = b.stock || {}; history = b.history || [];
      Object.assign(settings, b.settings || {});
      store.set(K.prices, prices); store.set(K.stock, stock); store.set(K.history, history); saveSettings();
      toast('اطلاعات بازگردانی شد ✅');
      location.reload();
    } catch { toast('این فایل، پشتیبان آشپزیار نیست'); }
    e.target.value = '';
  };

  // ---------- install
  let deferred;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (!standalone) $('#installBar').classList.add('on');
  });
  $('#installBtn').onclick = async () => {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      $('#installBar').classList.remove('on');
    } else {
      toast('از منوی مرورگر گزینه «افزودن به صفحه اصلی» را بزنید');
    }
  };
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIOS && !standalone) {
    $('#installText').innerHTML = 'برای نصب: دکمه <b>اشتراک‌گذاری</b> ⬆️ پایین صفحه را بزنید، سپس <b>Add to Home Screen</b>.';
    $('#installBtn').style.display = 'none';
    $('#installBar').classList.add('on');
  }
  window.addEventListener('appinstalled', () => $('#installBar').classList.remove('on'));

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  // ---------- start
  // menus edited in the admin panel and applied for testing on this device only
  function applyLocalTest() {
    const test = store.get('ash.localTest', null);
    if (!test) return;
    data = test;
    const bar = document.createElement('div');
    bar.className = 'banner warn';
    bar.innerHTML = '🧪 حالت آزمایشی: برنامه‌های ویرایش‌شده در پنل ادمین نمایش داده می‌شود. <button class="link" id="exitTest">خروج</button>';
    $('main').prepend(bar);
    $('#exitTest').onclick = () => { try { localStorage.removeItem('ash.localTest'); } catch {} location.reload(); };
  }

  (async () => {
    if (data) renderCalc();
    const ok = await loadData();
    applyLocalTest();
    if (ok || data) renderCalc();
  })();
})();
