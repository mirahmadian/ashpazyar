// Google Authenticator (TOTP) lock for the admin panel.
// Deters casual visitors only: the real protection is the GitHub token, which lives only in the admin's browser.
const AdminAuth = (() => {
  const SECRET = 'DFEFPPC6DUC34KCHMKX3W4D2J6Z2RGO7';
  const SESSION_KEY = 'ash.admin.session';
  const SESSION_HOURS = 12;

  function base32(s) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const c of s.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0');
    const out = new Uint8Array(Math.floor(bits.length / 8));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
    return out;
  }

  async function code(counter) {
    const key = await crypto.subtle.importKey('raw', base32(SECRET), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const msg = new ArrayBuffer(8);
    new DataView(msg).setUint32(4, counter);
    new DataView(msg).setUint32(0, Math.floor(counter / 2 ** 32));
    const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
    const o = h[19] & 15;
    const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    return String(n % 1e6).padStart(6, '0');
  }

  // accepts the previous, current and next 30-second code to tolerate clock drift
  async function verify(input) {
    const t = Math.floor(Date.now() / 30000);
    for (const d of [-1, 0, 1]) if ((await code(t + d)) === input) return true;
    return false;
  }

  const valid = () => {
    try { return Number(localStorage.getItem(SESSION_KEY)) > Date.now(); } catch { return false; }
  };

  function lock() {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    location.reload();
  }

  // resolves once the admin has entered a valid code
  function gate() {
    if (valid()) return Promise.resolve();
    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.id = 'authGate';
      box.style.padding = '0 16px';
      box.innerHTML = `<div class="card" style="max-width:380px;margin:60px auto;text-align:center">
        <div style="font-size:44px">🔐</div>
        <h2 style="justify-content:center">ورود به پنل مدیریت</h2>
        <p class="hint" style="margin-bottom:14px">کد ۶ رقمی برنامه Google Authenticator را وارد کنید.</p>
        <input id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="------" style="text-align:center;font-size:30px;letter-spacing:8px;font-weight:800" dir="ltr">
        <button class="btn" id="otpBtn" style="margin-top:12px">ورود</button>
        <p class="hint" id="otpMsg" style="color:var(--bad)"></p></div>`;
      document.body.appendChild(box);
      const inp = box.querySelector('#otp');
      const go = async () => {
        const v = Core.toEnDigits(inp.value).replace(/\D/g, '');
        if (v.length !== 6) return;
        if (await verify(v)) {
          try { localStorage.setItem(SESSION_KEY, String(Date.now() + SESSION_HOURS * 3600e3)); } catch {}
          box.remove();
          resolve();
        } else {
          box.querySelector('#otpMsg').textContent = 'کد اشتباه است یا منقضی شده. کد جدید را وارد کنید.';
          inp.value = '';
          inp.focus();
        }
      };
      inp.oninput = () => { if (Core.toEnDigits(inp.value).replace(/\D/g, '').length === 6) go(); };
      box.querySelector('#otpBtn').onclick = go;
      inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      setTimeout(() => inp.focus(), 100);
    });
  }

  return { gate, lock, verify, code };
})();
