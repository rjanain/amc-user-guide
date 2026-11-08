/*
 * Headless Chrome for the user guide's screenshots (Node 22+, no packages).
 *
 * shot(name, {clip, boxes}) saves ../screenshots/<name>.png and records,
 * in ../screenshots/<name>.json, where each named element is on it, in CSS
 * pixels from the top left corner of the picture. writeTex() turns those
 * records into ../screenshots/shots.tex, which the guide's callouts read.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
export const J = JSON.stringify;
export const SHOTS = new URL('../screenshots/', import.meta.url).pathname;
const WIDTH = 1440;
const HEIGHT = 900;
const SCALE = 2; // pictures at twice the CSS size: sharp in print

export async function startBrowser({ base, port = 9341, chrome = null }) {
  mkdirSync(SHOTS, { recursive: true });
  let proc = null;
  let profile = null;
  const open = async () => {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return targets.find((t) => t.type === 'page');
  };
  let page = await open().catch(() => null); // a Chrome already running on that port (CDP_PORT)
  if (!page) {
    const exe = chrome || process.env.CHROME
      || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
    profile = mkdtempSync(join(tmpdir(), 'amc-guide-'));
    proc = spawn(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`, `--window-size=${WIDTH},${HEIGHT}`, '--ignore-certificate-errors', 'about:blank'], { stdio: 'ignore' });
    for (let i = 0; i < 50 && !page; i += 1) { await sleep(200); page = await open().catch(() => null); }
    if (!page) throw new Error('Chrome did not start');
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    id += 1; const myId = id;
    const timer = setTimeout(() => { if (pending.delete(myId)) reject(new Error(`Chrome did not answer ${method}`)); }, 90000);
    pending.set(myId, (m) => { clearTimeout(timer); resolve(m); });
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable'); await send('Network.enable');
  // A hidden page doesn't paint (no animation frames: the LaTeX editor draws one line).
  await send('Page.bringToFront').catch(() => null);
  await send('Page.setWebLifecycleState', { state: 'active' }).catch(() => null);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => null);
  await send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => null);
  let size = [WIDTH, HEIGHT];
  const viewport = (w = WIDTH, h = HEIGHT) => { size = [w, h]; return send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: SCALE, mobile: false }); };
  await viewport();

  const b = {
    send, errors, base,
    async js(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || J(r.result.exceptionDetails));
      return r.result?.result?.value;
    },
    async waitFor(expression, timeout = 20000, what = '') {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try { if (await b.js(expression)) return true; } catch { /* navigating */ }
        await sleep(200);
      }
      throw new Error(`Timed out waiting for ${what || expression}`);
    },
    goto: (path) => send('Page.navigate', { url: base + path }),
    /* Clicks the first element matching `sel` (and containing `text`, if given). */
    click: (sel, text = null) => b.js(`(() => { const e = [...document.querySelectorAll(${J(sel)})].find((x) => ${J(text)} === null || x.textContent.includes(${J(text)})); if (!e) throw new Error('not found: ' + ${J(sel + (text ? ' "' + text + '"' : ''))}); e.scrollIntoView({block: 'nearest'}); e.click(); return true; })()`),
    has: (sel) => b.js(`!!document.querySelector(${J(sel)})`),
    setValue: (sel, v) => b.js(`(() => { const e = document.querySelector(${J(sel)}); if (!e) throw new Error('not found: ' + ${J(sel)}); e.focus(); e.value = ${J(v)}; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`),
    async setFiles(sel, files) {
      const r = await send('Runtime.evaluate', { expression: `document.querySelector(${J(sel)})` });
      if (!r.result.result.objectId) throw new Error('not found: ' + sel);
      await send('DOM.setFileInputFiles', { files, objectId: r.result.result.objectId });
    },
    async type(text) { for (const ch of text) { await send('Input.dispatchKeyEvent', { type: 'char', text: ch }); await sleep(30); } },
    async key(key, code = key, keyCode = 0) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
    },
    scroll: (sel, top) => b.js(`(() => { const e = document.querySelector(${J(sel)}); if (e) e.scrollTop = ${top}; return true; })()`),
    scrollTo: (sel, text = null, block = 'start') => b.js(`(() => { const e = [...document.querySelectorAll(${J(sel)})].find((x) => ${J(text)} === null || x.textContent.includes(${J(text)})); if (!e) throw new Error('not found: ' + ${J(sel)}); e.scrollIntoView({block: ${J(block)}}); return true; })()`),
    viewport,
    /* Waits until images, PDF frames and fonts have had time to paint. */
    async settle(ms = 1200) {
      await b.js(`document.fonts ? document.fonts.ready.then(() => true) : true`);
      await b.js(`Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 8000); }))).then(() => true)`);
      await sleep(ms);
    },
    /*
     * Saves a screenshot. clip: an element spec (below) or null for the whole
     * window, padded by `pad` CSS px. boxes: {key: spec}. A spec is a CSS
     * selector, {sel, text, i}, {x, y, w, h} in window pixels, or
     * {union: [spec, ...]}.
     */
    async shot(name, { clip = null, pad = 0, boxes = {} } = {}) {
      await b.js(`(() => { let s = document.getElementById('guide-shot-css'); if (!s) { s = document.createElement('style'); s.id = 'guide-shot-css'; s.textContent = '#toasts { display: none !important; }'; document.head.appendChild(s); } return true; })()`);
      const r = await b.js(`(() => {
        const find = (s) => {
          if (typeof s === 'string') s = { sel: s };
          if (s.union) {
            const rs = s.union.map(find).filter(Boolean);
            if (!rs.length) return null;
            const x = Math.min(...rs.map((q) => q.x)), y = Math.min(...rs.map((q) => q.y));
            return { x, y, w: Math.max(...rs.map((q) => q.x + q.w)) - x, h: Math.max(...rs.map((q) => q.y + q.h)) - y };
          }
          if ('x' in s) return s;
          let all = [...document.querySelectorAll(s.sel)].filter((e) => (s.text == null || e.textContent.includes(s.text)) && e.getClientRects().length);
          if (s.smallest) all = all.sort((p, q) => p.getBoundingClientRect().width * p.getBoundingClientRect().height - q.getBoundingClientRect().width * q.getBoundingClientRect().height);
          const e = all[s.i || 0];
          if (!e) return null;
          const q = e.getBoundingClientRect();
          return { x: q.left, y: q.top, w: q.width, h: q.height };
        };
        const W = ${size[0]}, H = ${size[1]};
        let c = ${J(clip)} ? find(${J(clip)}) : { x: 0, y: 0, w: W, h: H };
        if (!c) return { error: 'clip not found' };
        const p = ${J(typeof pad === 'number' ? [pad, pad, pad, pad] : pad)};
        const x0 = Math.max(0, Math.floor(c.x - p[3])), y0 = Math.max(0, Math.floor(c.y - p[0]));
        const x1 = Math.min(W, Math.ceil(c.x + c.w + p[1])), y1 = Math.min(H, Math.ceil(c.y + c.h + p[2]));
        const boxes = {}, missing = [];
        for (const [k, s] of Object.entries(${J(boxes)})) {
          const q = find(s);
          if (!q) { missing.push(k); continue; }
          // Kept inside the picture: an element can reach far beyond it (a long editor line).
          const l = Math.max(q.x, x0), tp = Math.max(q.y, y0), r = Math.min(q.x + q.w, x1), bt = Math.min(q.y + q.h, y1);
          if (r <= l || bt <= tp) { missing.push(k + ' (outside the picture)'); continue; }
          boxes[k] = [l - x0, tp - y0, r - l, bt - tp].map((v) => Math.round(v * 2) / 2);
        }
        return { clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, boxes, missing };
      })()`);
      if (r.error) throw new Error(`${name}: ${r.error}`);
      if (r.missing.length) console.log(`  ! ${name}: no element for ${r.missing.join(', ')}`);
      // Let the page finish painting (a dialog that just re-rendered can be caught half drawn).
      await b.js(`new Promise((done) => { requestAnimationFrame(() => requestAnimationFrame(() => done(true))); setTimeout(() => done(true), 400); })`);
      await sleep(150);
      const png = await send('Page.captureScreenshot', { format: 'png', clip: { ...r.clip, scale: 1 }, captureBeyondViewport: false });
      writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(png.result.data, 'base64'));
      writeFileSync(join(SHOTS, `${name}.json`), J({ w: r.clip.width, h: r.clip.height, boxes: r.boxes }, null, 1));
      console.log(`  shot ${name} (${r.clip.width}x${r.clip.height}, ${Object.keys(r.boxes).length} boxes)`);
    },
    async close() {
      try { ws.close(); } catch { /* closed */ }
      if (proc) {
        await new Promise((done) => { proc.once('exit', done); setTimeout(done, 5000); proc.kill(); });
        try { rmSync(profile, { recursive: true, force: true }); } catch { /* still in use */ }
      }
    },
  };
  return b;
}

/* Every shot's size and boxes, as TeX: \shotdata{name}{w}{h} and \shotbox{name}{key}{x}{y}{w}{h}. */
export function writeTex() {
  const lines = ['% Made by capture/capture.mjs from the screenshots\' records: do not edit.'];
  for (const f of readdirSync(SHOTS).filter((x) => x.endsWith('.json') && !x.startsWith('._')).sort()) {
    const name = f.slice(0, -5);
    const d = JSON.parse(readFileSync(join(SHOTS, f), 'utf8'));
    lines.push(`\\shotdata{${name}}{${d.w}}{${d.h}}`);
    for (const [k, [x, y, w, h]] of Object.entries(d.boxes)) lines.push(`\\shotbox{${name}}{${k}}{${x}}{${y}}{${w}}{${h}}`);
  }
  writeFileSync(join(SHOTS, 'shots.tex'), lines.join('\n') + '\n');
}
