(() => {
  const { esc, store, num, fa } = Core;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const K = { draft: 'ash.admin.draft', gh: 'ash.admin.gh' };
  let data = null;
  let dirty = false;
  let planId = null;
  const gh = Object.assign({ owner: '', repo: '', branch: 'main', path: 'data/menus.json', token: '' }, store.get(K.gh, {}));

  const UNITS = [['g', 'گرم (خرید با کیلو)'], ['ml', 'میلی‌لیتر (خرید با لیتر)'], ['عدد', 'عدد'], ['حبه', 'حبه'], ['بسته', 'بسته']];
  const unitShort = (u) => (u === 'g' ? 'گرم' : u === 'ml' ? 'میلی' : u);

  let tt;
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2600); };
  const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  function touch() {
    dirty = true;
    store.set(K.draft, { data, dirty: true });
    $('#dirty').classList.add('on');
  }

  // ---------- tabs
  let tab = 'plans';
  $$('#atabs button').forEach((b) => (b.onclick = () => openTab(b.dataset.t)));
  $('#goPublish').onclick = () => openTab('publish');
  function openTab(t) {
    tab = t;
    $$('#atabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === t));
    $$('.ascreen').forEach((s) => s.classList.toggle('on', s.id === 't-' + t));
    render();
  }
  function render() {
    ({ plans: renderPlans, items: renderItems, recipes: renderRecipes, groups: renderGroups, publish: renderPublish })[tab]();
  }

  // ---------- reference options
  function refOptions(sel) {
    const items = Object.entries(data.items).sort((a, b) => a[1].name.localeCompare(b[1].name, 'fa'));
    const recs = Object.entries(data.recipes).sort((a, b) => a[1].name.localeCompare(b[1].name, 'fa'));
    return `<optgroup label="دستور پخت / سالاد">${recs.map(([id, r]) => `<option value="r:${esc(id)}" ${sel === 'r:' + id ? 'selected' : ''}>🍳 ${esc(r.name)}</option>`).join('')}</optgroup>
      <optgroup label="اقلام">${items.map(([id, it]) => `<option value="i:${esc(id)}" ${sel === 'i:' + id ? 'selected' : ''}>${esc(it.name)}</option>`).join('')}</optgroup>`;
  }
  const itemOptions = (sel) => Object.entries(data.items).sort((a, b) => a[1].name.localeCompare(b[1].name, 'fa'))
    .map(([id, it]) => `<option value="${esc(id)}" ${sel === id ? 'selected' : ''}>${esc(it.name)}</option>`).join('');
  const entryUnit = (e) => (e.r ? 'پرس' : unitShort(data.items[e.i]?.unit || ''));
  const qVal = (q) => (q == null ? '' : String(q));

  // ---------- plans
  function renderPlans() {
    const el = $('#t-plans');
    if (!data.plans.find((p) => p.id === planId)) planId = data.plans[0]?.id;
    const plan = data.plans.find((p) => p.id === planId);
    let h = `<div class="toolbar">
      <select id="planSel">${data.plans.map((p) => `<option value="${esc(p.id)}" ${p.id === planId ? 'selected' : ''}>${esc(p.name)}${p.active === false ? ' (غیرفعال)' : ''}</option>`).join('')}</select>
      <button class="btn ghost" id="planNew">+ برنامه جدید</button>
      <button class="btn ghost" id="planDup">کپی این برنامه</button>
      <button class="btn danger" id="planDel">حذف</button></div>`;
    if (!plan) { el.innerHTML = h + '<div class="empty">برنامه‌ای وجود ندارد.</div>'; bindPlanToolbar(); return; }

    h += `<div class="card"><div class="grid2">
      <label class="field"><span>نام برنامه</span><input data-f="name" value="${esc(plan.name)}"></label>
      <label class="field"><span>توضیح (برای کاربر نمایش داده می‌شود)</span><input data-f="note" value="${esc(plan.note || '')}"></label></div>
      <label class="check"><input type="checkbox" data-f="active" ${plan.active !== false ? 'checked' : ''}><span>فعال (به کاربران نمایش داده شود)</span></label>
      <div class="field"><span>این برنامه برای کدام گروه هتل‌هاست؟</span><div class="chips">${data.groups.map((g) => `<button class="chip ${plan.groups?.includes(g.id) ? 'on' : ''}" data-g="${esc(g.id)}">${esc(g.name)}</button>`).join('')}</div></div>
      <p class="hint">راهنما: «مقدار» سرانه هر نفر است (گرم، عدد یا تعداد پرس). «٪» یعنی چند درصد زائران آن را می‌گیرند؛ خالی یعنی ۱۰۰٪. مثال: نوشابه ۱۱۰٪ ← مقدار ۱ و درصد ۱۱۰. مربا ۶۰٪ ← مقدار ۱ و درصد ۶۰. مقدار خالی یعنی «به مقدار لازم».</p></div>`;

    plan.days.forEach((d, di) => {
      h += `<div class="card" data-day="${di}"><div class="dayhead">
        <input type="text" data-dn value="${esc(d.name)}">
        <label class="check" style="margin:0"><input type="checkbox" data-dx ${d.extra ? 'checked' : ''}><span>وعده اضافه (در سهمیه روزانه حساب نشود)</span></label>
        <button class="mini" data-up ${di === 0 ? 'disabled' : ''}>↑</button>
        <button class="mini" data-dup>کپی روز</button>
        <button class="mini red" data-ddel>حذف روز</button></div>`;
      for (const [m, mName] of Core.MEALS) {
        const meal = d[m];
        h += `<div class="mealbox" data-m="${m}">`;
        if (!meal) { h += `<button class="mini" data-addmeal>+ افزودن ${mName}</button></div>`; continue; }
        h += `<label>${mName}: <input data-mt value="${esc(meal.title || '')}" placeholder="عنوان غذا، مثلاً املت"><button class="mini red" data-delmeal title="حذف وعده">✕</button></label>
          <div class="ehead"><span>قلم یا دستور</span><span>مقدار</span><span>٪</span><span></span></div>`;
        (meal.e || []).forEach((e, ei) => {
          h += `<div class="erow" data-e="${ei}"><select data-ref>${refOptions(e.i ? 'i:' + e.i : 'r:' + e.r)}</select>
            <div class="suffix"><input data-q inputmode="decimal" value="${qVal(e.q)}" placeholder="لازم"><em style="font-size:11px;left:6px">${entryUnit(e)}</em></div>
            <input data-p inputmode="decimal" value="${e.p == null ? '' : e.p}" placeholder="۱۰۰">
            <button class="x" data-edel>✕</button></div>`;
        });
        h += `<button class="mini" data-eadd>+ افزودن قلم</button></div>`;
      }
      h += '</div>';
    });
    h += `<button class="btn ghost" id="dayAdd">+ افزودن روز</button>`;
    el.innerHTML = h;
    bindPlanToolbar();

    // plan fields
    $$('[data-f]', el).forEach((inp) => (inp.onchange = () => {
      const f = inp.dataset.f;
      plan[f] = inp.type === 'checkbox' ? inp.checked : inp.value.trim();
      touch();
      if (f === 'name' || f === 'active') renderPlans();
    }));
    $$('.chips [data-g]', el).forEach((b) => (b.onclick = () => {
      const g = b.dataset.g;
      plan.groups = plan.groups || [];
      plan.groups = plan.groups.includes(g) ? plan.groups.filter((x) => x !== g) : [...plan.groups, g];
      touch();
      b.classList.toggle('on');
    }));
    $('#dayAdd').onclick = () => {
      plan.days.push({ name: 'روز ' + fa(plan.days.length + 1), b: { title: '', e: [] }, l: { title: '', e: [] }, d: { title: '', e: [] } });
      touch(); renderPlans();
    };

    $$('[data-day]', el).forEach((card) => {
      const d = plan.days[+card.dataset.day];
      const di = +card.dataset.day;
      $('[data-dn]', card).onchange = (e) => { d.name = e.target.value.trim(); touch(); };
      $('[data-dx]', card).onchange = (e) => { if (e.target.checked) d.extra = true; else delete d.extra; touch(); };
      $('[data-up]', card).onclick = () => { [plan.days[di - 1], plan.days[di]] = [plan.days[di], plan.days[di - 1]]; touch(); renderPlans(); };
      $('[data-dup]', card).onclick = () => { const c = structuredClone(d); c.name += ' (کپی)'; plan.days.splice(di + 1, 0, c); touch(); renderPlans(); };
      $('[data-ddel]', card).onclick = () => { if (confirm(`«${d.name}» حذف شود؟`)) { plan.days.splice(di, 1); touch(); renderPlans(); } };

      $$('.mealbox', card).forEach((mb) => {
        const m = mb.dataset.m;
        const add = $('[data-addmeal]', mb);
        if (add) { add.onclick = () => { d[m] = { title: '', e: [] }; touch(); renderPlans(); }; return; }
        const meal = d[m];
        $('[data-mt]', mb).onchange = (e) => { meal.title = e.target.value.trim(); touch(); };
        $('[data-delmeal]', mb).onclick = (e) => { e.preventDefault(); if (confirm('این وعده حذف شود؟')) { delete d[m]; touch(); renderPlans(); } };
        $('[data-eadd]', mb).onclick = () => { meal.e.push({ i: Object.keys(data.items)[0], q: 1 }); touch(); renderPlans(); };
        $$('.erow', mb).forEach((row) => {
          const e = meal.e[+row.dataset.e];
          $('[data-ref]', row).onchange = (ev) => {
            const [k, id] = ev.target.value.split(':');
            delete e.i; delete e.r;
            e[k] = id;
            touch(); renderPlans();
          };
          $('[data-q]', row).onchange = (ev) => { const v = ev.target.value.trim(); e.q = v === '' ? null : num(v); touch(); };
          $('[data-p]', row).onchange = (ev) => { const v = ev.target.value.trim(); if (v === '' || num(v) === 100) delete e.p; else e.p = num(v); touch(); };
          $('[data-edel]', row).onclick = () => { meal.e.splice(+row.dataset.e, 1); touch(); renderPlans(); };
        });
      });
    });
  }

  function bindPlanToolbar() {
    $('#planSel').onchange = (e) => { planId = e.target.value; renderPlans(); };
    $('#planNew').onclick = () => {
      const name = prompt('نام برنامه جدید:');
      if (!name) return;
      const p = { id: newId('p'), name, groups: [], active: true, note: '', days: [] };
      for (let i = 1; i <= 6; i++) p.days.push({ name: 'روز ' + fa(i), b: { title: '', e: [] }, l: { title: '', e: [] }, d: { title: '', e: [] } });
      data.plans.push(p); planId = p.id; touch(); renderPlans();
    };
    $('#planDup').onclick = () => {
      const src = data.plans.find((p) => p.id === planId);
      if (!src) return;
      const p = structuredClone(src);
      p.id = newId('p'); p.name = src.name + ' (کپی)'; p.active = false;
      data.plans.push(p); planId = p.id; touch(); renderPlans();
      toast('کپی ساخته شد (غیرفعال). بعد از ویرایش فعالش کنید.');
    };
    $('#planDel').onclick = () => {
      const p = data.plans.find((x) => x.id === planId);
      if (!p || !confirm(`برنامه «${p.name}» کامل حذف شود؟`)) return;
      data.plans = data.plans.filter((x) => x !== p); touch(); renderPlans();
    };
  }

  // ---------- usage checks
  function usage(kind, id) {
    let n = 0;
    for (const p of data.plans) for (const d of p.days) for (const [m] of Core.MEALS) for (const e of d[m]?.e || []) if (e[kind] === id) n++;
    if (kind === 'i') for (const r of Object.values(data.recipes)) for (const g of r.ing) if (g.i === id) n++;
    return n;
  }

  // ---------- items
  function renderItems() {
    const cats = [...new Set(Object.values(data.items).map((i) => i.cat).filter(Boolean))];
    const list = Object.entries(data.items).sort((a, b) => (a[1].cat || '').localeCompare(b[1].cat || '', 'fa') || a[1].name.localeCompare(b[1].name, 'fa'));
    let h = `<div class="card"><p class="hint" style="margin:0 0 10px">واحد «گرم» یعنی کاربر آن را کیلویی می‌خرد و قیمت را برای کیلو وارد می‌کند. اقلامی که در برنامه‌ها استفاده شده‌اند قابل حذف نیستند.</p>
      <button class="btn ghost" id="itemAdd">+ قلم جدید</button></div>
      <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist><div class="card">`;
    for (const [id, it] of list) {
      const used = usage('i', id);
      h += `<div class="irow" data-id="${esc(id)}"><input data-k="name" value="${esc(it.name)}">
        <select data-k="unit">${UNITS.map(([u, l]) => `<option value="${esc(u)}" ${u === it.unit ? 'selected' : ''}>${l}</option>`).join('')}${UNITS.some(([u]) => u === it.unit) ? '' : `<option selected>${esc(it.unit)}</option>`}</select>
        <input data-k="cat" list="cats" value="${esc(it.cat || '')}" placeholder="دسته">
        <button class="x" data-del ${used ? `disabled title="در ${used} جا استفاده شده" style="opacity:.35"` : ''}>✕</button></div>`;
    }
    h += '</div>';
    $('#t-items').innerHTML = h;
    $('#itemAdd').onclick = () => {
      const name = prompt('نام قلم جدید:');
      if (!name) return;
      data.items[newId('i')] = { name: name.trim(), unit: 'عدد', cat: 'سایر' };
      touch(); renderItems();
    };
    $$('#t-items .irow').forEach((row) => {
      const it = data.items[row.dataset.id];
      $$('[data-k]', row).forEach((inp) => (inp.onchange = () => { it[inp.dataset.k] = inp.value.trim(); touch(); }));
      $('[data-del]', row).onclick = () => { if (confirm(`«${it.name}» حذف شود؟`)) { delete data.items[row.dataset.id]; touch(); renderItems(); } };
    });
  }

  // ---------- recipes
  function renderRecipes() {
    let h = `<div class="card"><p class="hint" style="margin:0 0 10px">مقدار هر ماده برای <b>یک پرس</b> (یک نفر) است. مقدار خالی یعنی «به مقدار لازم» (در خرید حساب نمی‌شود).</p>
      <button class="btn ghost" id="recAdd">+ دستور پخت جدید</button></div>`;
    for (const [id, r] of Object.entries(data.recipes)) {
      const used = usage('r', id);
      h += `<div class="card" data-rid="${esc(id)}"><div class="dayhead"><input type="text" data-rk="name" value="${esc(r.name)}">
        <button class="mini red" data-rdel ${used ? `disabled title="در ${used} جا استفاده شده" style="opacity:.35"` : ''}>حذف</button></div>
        <div class="ehead" style="margin-top:10px;grid-template-columns:1fr 110px 40px"><span>ماده</span><span>مقدار برای ۱ نفر</span><span></span></div>`;
      r.ing.forEach((g, gi) => {
        h += `<div class="erow" style="grid-template-columns:1fr 110px 40px" data-g="${gi}"><select data-gi>${itemOptions(g.i)}</select>
          <div class="suffix"><input data-gq inputmode="decimal" value="${qVal(g.q)}" placeholder="لازم"><em style="font-size:11px;left:6px">${unitShort(data.items[g.i]?.unit || '')}</em></div>
          <button class="x" data-gdel>✕</button></div>`;
      });
      h += `<button class="mini" data-gadd>+ افزودن ماده</button>
        <label class="field" style="margin-top:10px"><span>طرز تهیه</span><textarea rows="3" data-rk="method">${esc(r.method || '')}</textarea></label></div>`;
    }
    $('#t-recipes').innerHTML = h;
    $('#recAdd').onclick = () => {
      const name = prompt('نام دستور پخت (مثلاً املت یا سالاد کاهو):');
      if (!name) return;
      data.recipes[newId('r')] = { name: name.trim(), method: '', ing: [] };
      touch(); renderRecipes();
    };
    $$('#t-recipes [data-rid]').forEach((card) => {
      const r = data.recipes[card.dataset.rid];
      $$('[data-rk]', card).forEach((inp) => (inp.onchange = () => { r[inp.dataset.rk] = inp.value.trim(); touch(); }));
      $('[data-rdel]', card).onclick = () => { if (confirm(`«${r.name}» حذف شود؟`)) { delete data.recipes[card.dataset.rid]; touch(); renderRecipes(); } };
      $('[data-gadd]', card).onclick = () => { r.ing.push({ i: Object.keys(data.items)[0], q: null }); touch(); renderRecipes(); };
      $$('[data-g]', card).forEach((row) => {
        const g = r.ing[+row.dataset.g];
        $('[data-gi]', row).onchange = (e) => { g.i = e.target.value; touch(); renderRecipes(); };
        $('[data-gq]', row).onchange = (e) => { const v = e.target.value.trim(); g.q = v === '' ? null : num(v); touch(); };
        $('[data-gdel]', row).onclick = () => { r.ing.splice(+row.dataset.g, 1); touch(); renderRecipes(); };
      });
    });
  }

  // ---------- groups
  function renderGroups() {
    let h = `<div class="card"><p class="hint" style="margin:0 0 10px">سهم دورچین هر گروه به دلار، برای هر زائر در هر روز.</p>`;
    data.groups.forEach((g, gi) => {
      h += `<div class="erow" style="grid-template-columns:1fr 120px 40px" data-gi="${gi}"><input data-k="name" value="${esc(g.name)}">
        <div class="suffix"><input data-k="usd" inputmode="decimal" value="${g.usd}"><em>دلار</em></div><button class="x" data-del>✕</button></div>`;
    });
    h += `<button class="mini" id="grpAdd">+ گروه جدید</button></div>`;
    $('#t-groups').innerHTML = h;
    $('#grpAdd').onclick = () => { data.groups.push({ id: newId('g'), name: 'گروه جدید', usd: 2 }); touch(); renderGroups(); };
    $$('#t-groups [data-gi]').forEach((row) => {
      const g = data.groups[+row.dataset.gi];
      $$('[data-k]', row).forEach((inp) => (inp.onchange = () => { g[inp.dataset.k] = inp.dataset.k === 'usd' ? num(inp.value) : inp.value.trim(); touch(); }));
      $('[data-del]', row).onclick = () => {
        if (!confirm(`گروه «${g.name}» حذف شود؟`)) return;
        data.groups.splice(+row.dataset.gi, 1);
        for (const p of data.plans) p.groups = (p.groups || []).filter((x) => x !== g.id);
        touch(); renderGroups();
      };
    });
  }

  // ---------- validation
  function validate() {
    const errs = [];
    for (const p of data.plans) p.days.forEach((d) => {
      for (const [m, mName] of Core.MEALS) for (const e of d[m]?.e || []) {
        if (e.i && !data.items[e.i]) errs.push(`${p.name} / ${d.name} / ${mName}: قلم حذف‌شده`);
        if (e.r && !data.recipes[e.r]) errs.push(`${p.name} / ${d.name} / ${mName}: دستور پخت حذف‌شده`);
      }
    });
    for (const r of Object.values(data.recipes)) for (const g of r.ing) if (!data.items[g.i]) errs.push(`دستور «${r.name}»: ماده حذف‌شده`);
    return errs;
  }

  // ---------- saving into the project folder (Chrome / Edge)
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('ashpazyar-admin', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(k) {
    try {
      const db = await idb();
      return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
    } catch { return null; }
  }
  async function idbSet(k, v) {
    try {
      const db = await idb();
      await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; });
    } catch {}
  }
  async function pickDir() {
    if (!window.showDirectoryPicker) { toast('این مرورگر پشتیبانی نمی‌کند؛ از Chrome یا Edge استفاده کنید'); return null; }
    try {
      const dir = await window.showDirectoryPicker({ id: 'ashpazyar-data', mode: 'readwrite' });
      let hasMenus = true;
      try { await dir.getFileHandle('menus.json'); } catch { hasMenus = false; }
      if (!hasMenus && !confirm(`در پوشه «${dir.name}» فایل menus.json نیست. مطمئنید این پوشه data پروژه است؟`)) return null;
      await idbSet('dataDir', dir);
      return dir;
    } catch (e) {
      if (e.name !== 'AbortError') toast('خطا: ' + e.message);
      return null;
    }
  }
  async function writeFile(dir, name, text) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }
  function downloadFiles() {
    const json = JSON.stringify(data, null, 1);
    const save = (name, text, type) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type }));
      a.download = name;
      a.click();
    };
    save('menus.json', json, 'application/json');
    setTimeout(() => save('menus.js', builtInJs(json), 'text/javascript'), 400);
  }

  // ---------- publish
  function renderPublish() {
    const testing = !!store.get('ash.localTest', null);
    $('#t-publish').innerHTML = `<div class="card"><h2>💾 ذخیره در پوشه پروژه (روی همین کامپیوتر)</h2>
      <p class="hint">تغییرات مستقیم در پوشه <code>data</code> پروژه ذخیره می‌شود. بار اول از شما می‌خواهد پوشه <code>data</code> را انتخاب کنید؛ بعد از آن فقط یک کلیک است.</p>
      <button class="btn" id="saveDisk" style="margin-top:8px">💾 ذخیره در پوشه data</button>
      <button class="link" id="pickDisk">انتخاب یا تغییر پوشه</button>
      <p class="hint" id="diskStatus"></p></div>

      <div class="card"><h2>🧪 آزمایش روی همین دستگاه (بدون ذخیره فایل)</h2>
      <p class="hint">تغییرات فقط در برنامه کاربرِ همین مرورگر دیده می‌شود تا قبل از ذخیره یا انتشار امتحانش کنید.</p>
      <div class="btn-row"><button class="btn ghost" id="testOn">اعمال روی همین دستگاه</button>
      <button class="btn ghost" id="testOff" ${testing ? '' : 'disabled style="opacity:.4"'}>خروج از حالت آزمایشی</button></div></div>

      <div class="card"><h2>انتشار برای همه کاربران</h2>
      <p class="hint">با زدن «انتشار»، فایل برنامه‌ها در مخزن گیت‌هاب ذخیره می‌شود و گوشی کاربران دفعه بعد که برنامه را با اینترنت باز کنند، به‌روز می‌شود.</p>
      <div class="grid2" style="margin-top:12px">
        <label class="field"><span>نام کاربری گیت‌هاب (owner)</span><input id="ghOwner" dir="ltr" value="${esc(gh.owner)}"></label>
        <label class="field"><span>نام مخزن (repo)</span><input id="ghRepo" dir="ltr" value="${esc(gh.repo)}"></label>
        <label class="field"><span>شاخه (branch)</span><input id="ghBranch" dir="ltr" value="${esc(gh.branch)}"></label>
        <label class="field"><span>مسیر فایل</span><input id="ghPath" dir="ltr" value="${esc(gh.path)}"></label>
      </div>
      <label class="field"><span>توکن دسترسی (فقط روی همین دستگاه ذخیره می‌شود)</span><input id="ghToken" type="password" dir="ltr" value="${esc(gh.token)}" placeholder="github_pat_..."></label>
      <label class="field"><span>توضیح تغییر (اختیاری)</span><input id="ghMsg" placeholder="مثلاً: برنامه آبان اضافه شد"></label>
      <button class="btn" id="ghPublish">🚀 انتشار</button>
      <p class="hint" id="ghStatus"></p></div>

      <div class="card"><h2>فایل</h2>
      <button class="btn ghost" id="ul">📤 بارگذاری فایل menus.json</button>
      <input type="file" id="ulFile" accept=".json,application/json" hidden>
      <button class="btn danger" id="reset" style="margin-top:10px">دور ریختن تغییرات و بارگیری نسخه منتشرشده</button></div>

      <div class="card"><h2>ساخت توکن (فقط یک بار)</h2><ol class="hint">
        <li>در گیت‌هاب: <code>Settings → Developer settings → Personal access tokens → Fine-grained tokens</code></li>
        <li>«Generate new token» را بزنید؛ در Repository access فقط همین مخزن را انتخاب کنید.</li>
        <li>در Permissions، گزینه <b>Contents</b> را روی <b>Read and write</b> بگذارید.</li>
        <li>توکن را کپی و در کادر بالا بچسبانید.</li></ol></div>`;

    const saveGh = () => {
      Object.assign(gh, { owner: $('#ghOwner').value.trim(), repo: $('#ghRepo').value.trim(), branch: $('#ghBranch').value.trim() || 'main', path: $('#ghPath').value.trim() || 'data/menus.json', token: $('#ghToken').value.trim() });
      store.set(K.gh, gh);
    };
    $$('#t-publish input[id^=gh]').forEach((i) => i.id !== 'ghMsg' && (i.onchange = saveGh));
    $('#ghPublish').onclick = async () => {
      saveGh();
      const errs = validate();
      if (errs.length) return alert('ایراد در داده‌ها:\n' + errs.slice(0, 10).join('\n'));
      if (!gh.owner || !gh.repo || !gh.token) return toast('اطلاعات گیت‌هاب را کامل کنید');
      const st = $('#ghStatus');
      st.textContent = 'در حال انتشار…';
      try {
        await publish($('#ghMsg').value.trim() || 'به‌روزرسانی برنامه‌های غذایی');
        dirty = false;
        store.set(K.draft, { data, dirty: false });
        $('#dirty').classList.remove('on');
        st.textContent = '✅ منتشر شد. تا چند دقیقه دیگر برای همه کاربران قابل مشاهده است.';
      } catch (e) {
        st.textContent = '❌ خطا: ' + e.message;
      }
    };
    $('#testOn').onclick = () => {
      const errs = validate();
      if (errs.length) return alert('ایراد در داده‌ها:\n' + errs.slice(0, 10).join('\n'));
      store.set('ash.localTest', data);
      toast('اعمال شد. صفحه برنامه (index.html) را باز یا تازه کنید.');
      renderPublish();
    };
    $('#testOff').onclick = () => {
      try { localStorage.removeItem('ash.localTest'); } catch {}
      toast('حالت آزمایشی خاموش شد');
      renderPublish();
    };
    const diskMsg = (m) => ($('#diskStatus').textContent = m);
    idbGet('dataDir').then((h) => h && diskMsg(`پوشه انتخاب‌شده: ${h.name}`));
    $('#pickDisk').onclick = async () => { if (await pickDir()) diskMsg('پوشه ذخیره شد. حالا «ذخیره در پوشه data» را بزنید.'); };
    $('#saveDisk').onclick = async () => {
      const errs = validate();
      if (errs.length) return alert('ایراد در داده‌ها:\n' + errs.slice(0, 10).join('\n'));
      if (!window.showDirectoryPicker) return downloadFiles();
      try {
        let dir = await idbGet('dataDir');
        if (!dir || (await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') dir = await pickDir();
        if (!dir) return;
        data.updated = new Date().toISOString();
        const json = JSON.stringify(data, null, 1);
        await writeFile(dir, 'menus.json', json);
        await writeFile(dir, 'menus.js', builtInJs(json));
        store.set(K.draft, { data, dirty });
        try { localStorage.removeItem('ash.localTest'); } catch {}
        diskMsg(`✅ ذخیره شد در پوشه «${dir.name}» — ${new Date().toLocaleTimeString('fa-IR')}. صفحه برنامه را تازه کنید.`);
        toast('در پوشه data ذخیره شد ✅');
      } catch (e) {
        if (e.name !== 'AbortError') diskMsg('❌ خطا: ' + e.message);
      }
    };
    $('#ul').onclick = () => $('#ulFile').click();
    $('#ulFile').onchange = async (e) => {
      try {
        const d = JSON.parse(await e.target.files[0].text());
        if (!d.plans || !d.items) throw 0;
        data = d; touch(); toast('فایل بارگذاری شد');
      } catch { toast('فایل معتبر نیست'); }
    };
    $('#reset').onclick = async () => {
      if (!confirm('همه تغییرات منتشرنشده دور ریخته شود؟')) return;
      await loadPublished();
      toast('نسخه منتشرشده بارگیری شد');
      openTab('plans');
    };
  }

  const b64 = (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  // built-in copy used when the app is opened as a local file or offline on first run
  const builtInJs = (json) => `// Built-in copy of menus.json\nwindow.ASH_DATA = ${json};\n`;

  async function putFile(path, content, message) {
    const api = `https://api.github.com/repos/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
    const headers = { Authorization: 'Bearer ' + gh.token, Accept: 'application/vnd.github+json' };
    let sha;
    const cur = await fetch(`${api}?ref=${encodeURIComponent(gh.branch)}`, { headers, cache: 'no-store' });
    if (cur.ok) sha = (await cur.json()).sha;
    else if (cur.status !== 404) throw new Error(cur.status === 401 ? 'توکن نامعتبر است' : 'دسترسی به مخزن ممکن نشد (' + cur.status + ')');
    const res = await fetch(api, {
      method: 'PUT', headers,
      body: JSON.stringify({ message, content: b64(content), branch: gh.branch, ...(sha ? { sha } : {}) }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.message || res.status);
    }
  }

  async function publish(message) {
    const prev = { version: data.version, updated: data.updated };
    data.version = (data.version || 0) + 1;
    data.updated = new Date().toISOString();
    const json = JSON.stringify(data, null, 1);
    try {
      await putFile(gh.path, json, message);
    } catch (e) {
      Object.assign(data, prev);
      throw e;
    }
    // built-in copy used when the app is opened as a local file or offline on first run
    await putFile(gh.path.replace(/\.json$/, '.js'), builtInJs(json), message);
  }

  async function loadPublished() {
    try {
      const r = await fetch('data/menus.json?t=' + Date.now(), { cache: 'no-store' });
      data = await r.json();
    } catch {
      if (!window.ASH_DATA) throw new Error('no data');
      data = structuredClone(window.ASH_DATA);
    }
    dirty = false;
    store.set(K.draft, { data, dirty: false });
    $('#dirty').classList.remove('on');
  }

  (async () => {
    const draft = store.get(K.draft, null);
    if (draft?.dirty && draft.data) {
      data = draft.data;
      dirty = true;
      $('#dirty').classList.add('on');
    } else {
      try { await loadPublished(); } catch { data = draft?.data; }
    }
    if (!data) { $('main').innerHTML = '<div class="empty">فایل برنامه‌ها بارگیری نشد.</div>'; return; }
    render();
  })();
})();
