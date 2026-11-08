/*
 * Takes the user guide's screenshots on a test copy of the app (see
 * README.md): a demo exam taken from its questions to its annotated
 * sheets, templates, question banks and history.
 *
 *   node capture.mjs [scene ...]     every scene, in order, when none is named
 *
 * Scenes run in order and each leaves the app as the next one expects, so
 * run from the first one named onwards (e.g. `node capture.mjs from:marking`).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { J, sleep, startBrowser, writeTex } from './driver.mjs';

const BASE = process.env.GUIDE_BASE || 'https://localhost:8096';
const USER = process.env.GUIDE_USER || 'demo_instructor';
const PASS = process.env.GUIDE_PASS || 'Demo@1234!4567';
const CONTAINER = process.env.GUIDE_CONTAINER || 'amcguide-amc-web-1';
const HERE = new URL('.', import.meta.url).pathname;
const EXAM = process.env.GUIDE_EXAM || 'Maths Unit Test 1';   // another name: for the demo portal's exams (demo/make-seed.sh)
const EXAM2 = 'Maths Unit Test 2';
const OLY = 'Olympiad Practice Paper';
const BANK = 'Class 8 Mathematics';
const enc = encodeURIComponent;
const file = (n) => readFileSync(join(HERE, n), 'utf8');

let b;
const api = (url, body) => b.js(`fetch(${J(url)}, {method: 'POST', headers: {...headers(), 'Content-Type': 'application/json'}, body: JSON.stringify(${J(body)})}).then(r => r.json())`);
const getApi = (url) => b.js(`getJSON(${J(url)})`);

async function openStep(exam, step, settle = 1500) {
  await b.goto(`/exam/${enc(exam)}/${step}`);
  await b.waitFor(`typeof S !== 'undefined' && S.project === ${J(exam)} && !!S.status && S.route.step === ${J(step)} && !document.querySelector('#main .skeleton')`, 30000, `${exam} › ${step}`);
  await b.settle(settle);
}
async function closeMenus() { await b.js(`S.menu = null; renderTop(); true`).catch(() => null); }
async function waitBuild(timeout = 240000) {
  await sleep(1200);
  await b.waitFor(`!document.querySelector('#work')`, timeout, 'the build');
  if (await b.has('.server-dialog')) await b.js('warn_ok(); true');
}
/* Folds the "What to do here" box of every step but the ones named. */
async function foldGuides(except = []) {
  const all = ['questions', 'marking-scheme', 'papers', 'print', 'upload-scans', 'check-scans', 'mark', 'match-students', 'export-marks', 'annotate'];
  const g = Object.fromEntries(all.filter((s) => !except.includes(s)).map((s) => [s, true]));
  await b.js(`store.set('guide', ${J(g)}); S.guide = store.get('guide', {}); true`);
}

/* Fills the wizard's first page. */
async function wizardDetails(name, klass, subject, date) {
  await b.goto('/new');
  await b.waitFor(`!!document.querySelector('#wiz-name')`);
  await b.setValue('[data-wiz=name]', name);
  await b.setValue('[data-wiz=class]', klass);
  await b.setValue('[data-wiz=subject]', subject);
  await b.setValue('[data-wiz=date]', date);
  await sleep(300);
}
async function wizardPick(group, id) {
  await b.click('[data-act=wiz-next]');
  await b.waitFor(`!!document.querySelector('.tpl-card')`);
  await b.click(`[data-act=wiz-group][data-v="${group}"]`);
  await b.click(`.tpl-card[data-id="${id}"]`);
  await b.settle(2500);
}
async function wizardCreate(name) {
  await b.click('[data-act=wiz-create]');
  await b.waitFor(`S.project === ${J(name)} && !!S.status`, 90000, `the exam ${name}`);
  await b.settle(1500);
  if (await b.has('#tour')) await b.js('endTour(); true');
}
/* The questions of a section, replaced by those of a "%%%% item name %%%%" document. */
async function replaceSection(group, text) {
  const cur = await getApi(`/ui/api/section-latex?group=${group}`);
  const r = await api('/ui/api/section-latex', { group, text: `${cur.text}\n${text}`, digests: cur.digests, apply: true });
  if (!r.ok) throw new Error(`section: ${r.error}`);
  for (const it of Object.keys(cur.digests)) {
    const d = await api('/ui/api/items', { op: 'delete', item: it });
    if (d.ok === false) throw new Error(`delete ${it}: ${d.error}`);
  }
}
/* Changes the main source file, as the LaTeX tab would. */
async function editSource(pairs) {
  const r = await b.js(`(async (pairs) => {
    const src = S.status.source;
    const url = '/fs/' + encodeURIComponent(S.project) + '/' + encodeURIComponent(src) + '?attach=0';
    let t = await (await fetch(url, {cache: 'no-store'})).text();
    for (const [a, z] of pairs) { if (!t.includes(a)) return 'missing: ' + a; t = t.replace(a, z); }
    const form = new FormData();
    form.append('file', new Blob([t], {type: 'text/plain'}), src);
    const r = await fetch('/upload/source', {method: 'POST', headers: {'AMC-project': S.project, 'AMC-sid': socket.id}, body: form});
    return (await r.json()).ok === true || 'refused';
  })(${J(pairs)})`);
  if (r !== true) throw new Error(`editSource: ${r}`);
}

const scenes = {
  /* Removes everything the demo account holds, so the run starts empty. */
  async reset() {
    await b.send('Network.clearBrowserCookies');
    await b.goto('/');
    await b.waitFor(`location.pathname === '/auth/login'`);
    await signIn();
    const ps = await b.js(`fetch('/ui/api/projects', {cache: 'no-store'}).then(r => r.json()).then(r => r.projects.map(p => p.name))`);
    for (const p of ps) {
      await b.js(`socket_emit('project-delete', ${J(p)}); true`);
      await b.waitFor(`fetch('/ui/api/projects', {cache: 'no-store'}).then(r => r.json()).then(r => !r.projects.some(p => p.name === ${J(p)}))`, 30000);
    }
    const bs = await getApi('/ui/api/banks');
    for (const x of bs.banks || []) await api('/ui/api/banks', { op: 'delete', name: x.name });
    const tr = await getApi('/ui/api/trash');
    for (const x of tr.items || []) await api('/ui/api/trash/delete', { id: x.id });
    // The first-run tour and the unfolded guide boxes, as a new teacher sees them.
    await b.js(`localStorage.clear(); true`);
    console.log(`  removed ${ps.length} exams, ${(bs.banks || []).length} banks, ${(tr.items || []).length} trash entries`);
  },

  async signin() {
    await b.send('Network.clearBrowserCookies');
    await b.goto('/');
    await b.waitFor(`location.pathname === '/auth/login'`);
    await b.settle(600);
    await b.shot('signin', { clip: '.card', pad: [70, 40, 40, 40], boxes: { user: 'input[name=username]', pass: 'input[name=password]', go: 'button[type=submit]' } });
    await signIn();
  },

  async dashEmpty() {
    await b.goto('/exams');
    await b.waitFor(`!!document.querySelector('#main .empty')`);
    await b.settle();
    await b.shot('dash-empty', { clip: { x: 0, y: 0, w: 1440, h: 430 }, boxes: {
      brand: '.brandmark', banks: { sel: '#topbar a.btn', text: 'Question banks' }, guide: '#topbar [data-menu=guide]',
      theme: '#topbar [data-act=theme]', account: '#topbar [data-menu=account]', trash: '[data-act=trash-open]',
      import: '[data-act=exam-import]', newexam: '#main a.btn-primary[href="/new"]' } });
    await b.click('#topbar [data-menu=account]');
    await sleep(400);
    await b.shot('account-menu', { clip: { union: ['#topbar [data-menu=account]', '#topbar .menu'] }, pad: [12, 16, 16, 120], boxes: { item: { sel: '#topbar .menu a', text: 'Account' } } });
    await closeMenus();
  },

  async wizard() {
    await wizardDetails(EXAM, '8A', 'Mathematics', '2026-11-20');
    await b.shot('wiz-details', { clip: '#main .page', pad: [0, 0, 8, 0], boxes: {
      steps: '.wizard-steps', name: '[data-wiz=name]', class: '[data-wiz=class]', subject: '[data-wiz=subject]',
      date: '[data-wiz=date]', next: '[data-act=wiz-next]' } });
    await wizardPick('school', 'blank');
    await b.shot('wiz-template', { boxes: {
      groups: '.segmented', search: '#wiz-search', blank: '.tpl-card[data-id=blank]', builder: '.tpl-card[data-id=builder]',
      plain: '.tpl-card[data-id=blank-txt]', preview: '.tpl-preview .tpl-pdf', next: '.tpl-preview [data-act=wiz-next]' } });
    await b.click('[data-act=wiz-next]');
    await b.waitFor(`!!document.querySelector('#wiz-code')`);
    await b.click('#wiz-code');
    await sleep(300);
    await b.setValue('[data-wiz=digits]', '4');
    await b.setValue('[data-wiz=copies]', '14');
    await b.settle(800);
    await b.shot('wiz-options', { clip: '#main .page', pad: [0, 0, 8, 0], boxes: {
      paper: '[data-act=wiz-style][data-v=paper]', separate: '[data-act=wiz-style][data-v=separate]', code: { sel: 'label.check', text: 'student number' },
      digits: '[data-wiz=digits]', copies: '[data-wiz=copies]', create: '[data-act=wiz-create]' } });
    await b.click('[data-act=wiz-create]');
    await b.waitFor(`S.project === ${J(EXAM)} && !!S.status`, 90000, 'the new exam');
    await b.waitFor(`!!document.querySelector('#tour')`, 10000, 'the tour');
    await b.settle(1500);
    await b.shot('tour', { boxes: { card: '#tour-card', spot: '.tour-spot' } });
    await b.click('[data-act=tour-end]');
  },

  /* The demo questions, a title on the paper, and the preview built. */
  async fill() {
    await openStep(EXAM, 'questions');
    await replaceSection('general', file('demo-questions.tex'));
    await editSource([['{\\large\\bf Exam title}\\hfill Date', `{\\large\\bf ${EXAM} \\textendash{} Class 8A}\\hfill 20 November 2026`]]);
    await openStep(EXAM, 'questions');
    await b.waitFor(`S.qdata && S.qdata.files.some(f => f.item === 'triangle')`, 20000, 'the questions');
    await b.click('[data-act=build]');
    await waitBuild();
    await b.settle(3000);
  },

  async workspace() {
    await openStep(EXAM, 'questions', 3000);
    await b.shot('workspace', { boxes: {
      top: '#topbar .chip', side: '#sidebar', guide: '#main .guide', list: '#q-list',
      form: '#q-form', preview: '#preview', build: '[data-act=build]', history: '[data-act=qf-history]',
      settings: { sel: '#sidebar a', text: 'Exam settings' }, tabs: '#main .q-tabs', before: { sel: '#sidebar .steps-group', i: 0 }, after: { sel: '#sidebar .steps-group', i: 1 } } });
  },

  /* The form, with the preview panel closed so the editor has room. */
  async questionForm() {
    await foldGuides();
    await b.js(`S.previewOpen = true; true`);
    await openStep(EXAM, 'questions');
    if (await b.js(`S.previewOpen`)) await b.click('#topbar [data-act=toggle-preview]');
    await b.viewport(1440, 1180);
    await b.click('.q-item', 'squares');
    await b.settle(1500);
    await b.shot('q-form', { clip: '#q-editor', pad: [10, 10, 10, 10], boxes: {
      list: '#q-list', add: '[data-act=q-add]', frombank: '[data-act=bank-pick]', item: { sel: '.q-item', text: 'squares' },
      kind: '#qf-kind', mode: '.q-mode', tools: { union: ['[data-act=q-latex]', '[data-act=q-delete]'] }, name: '#qf-id',
      scoring: '[data-act=qf-scoring]', text: '#qf-text', math: '#qf-preview', correct: { sel: '.qf-ans-correct', i: 0 },
      answers: '.q-answers', addans: { sel: '#q-form button', text: 'Add an answer' } } });
    await b.viewport();
  },

  async questionLatex() {
    await openStep(EXAM, 'questions');
    if (await b.js(`S.previewOpen`)) await b.click('#topbar [data-act=toggle-preview]');
    await b.click('.q-tabs button', 'LaTeX');
    await b.waitFor(`!!document.querySelector('.ace_line')`, 15000, 'the LaTeX editor');
    await b.settle(1500);
    await b.js(`(() => { const ed = ace.edit(document.querySelector('.ace_editor')); const n = ed.session.getDocument().getAllLines().findIndex((l) => l.includes('Maths Unit Test 1')); ed.scrollToLine(Math.max(0, n - 12), false, false); ed.gotoLine(n + 1, 0, false); return true; })()`);
    await b.settle(800);
    await b.shot('q-latex', { clip: '#main .page', pad: [0, 0, 0, 0], boxes: {
      tab: { sel: '.q-tabs button', text: 'LaTeX' }, title: { sel: '.ace_line', text: 'Maths' },
      school: { sel: '.ace_line', text: 'Technology' }, save: { sel: '#main button', text: 'Save' } } });
    await b.click('.q-tabs button', 'Questions');
  },

  async marking() {
    await openStep(EXAM, 'marking-scheme', 2500);
    await b.setValue('#score-M-preset', 'mz=1');
    await b.click('[data-act=save-scoring]');
    await sleep(1500);
    await b.setValue('[data-option=note_max]', '10');
    await b.setValue('[data-option=note_arrondi]', 'normal');
    await b.settle(2500);
    await b.shot('marking', { clip: { union: ['#main .page-header', '#main .grid-2'] }, pad: [8, 8, 12, 8], boxes: {
      single: '#score-S-preset', multiple: '#score-M-preset', save: '[data-act=save-scoring]', outof: '[data-option=note_max]',
      rounding: '[data-option=note_arrondi]', grain: '[data-option=note_grain]', blank: '[data-option=note_null]' } });
    await openStep(EXAM, 'marking-scheme', 2500);
    await b.scrollTo('#main .card', 'Click an answer');
    await b.settle(800);
    await b.shot('marking-questions', { clip: { sel: '#main .card', text: 'Click an answer' }, pad: 4, boxes: {
      total: { sel: '#main .card *', text: 'Total:', smallest: true }, chip: { sel: 'button.ans.is-correct', i: 0 }, wrong: { sel: 'button.ans:not(.is-correct)', i: 1 },
      scoring: { sel: '[data-act=q-edit]', i: 0 }, points: { sel: '.q-points', i: 0 } } });
    await b.click('[data-act=q-edit]');
    await b.waitFor(`!!document.querySelector('#layer .dialog')`);
    await b.settle(600);
    await b.shot('scoring-dialog', { clip: '#layer .dialog', pad: 16, boxes: {} });
    await b.click('#layer [data-act=dialog-cancel]').catch(() => b.key('Escape', 'Escape', 27));
  },

  async papers() {
    await openStep(EXAM, 'papers', 3500);
    await b.shot('papers', { boxes: {
      check: { sel: '#main .card', text: 'Check the layout' }, legend: '#preview .layout-legend', pages: { union: [{ sel: '#preview button', text: 'Previous' }, { sel: '#preview button', text: 'Next page' }] },
      ok: '[data-act=layout-ok]', wrong: '[data-act=layout-help]', copies: { sel: '#main .card', text: 'Number of copies' },
      docs: { sel: '#main .card', text: 'Documents' }, rebuild: '[data-act=build-papers]' } });
    await b.click('[data-act=layout-ok]');
    await b.waitFor(`S.status && !!S.status.layout_ok`, 10000);
  },

  async print() {
    await openStep(EXAM, 'print', 2500);
    await b.shot('print', { boxes: {
      files: { sel: '[data-act=print-route]', i: 0 }, printer: { sel: '[data-act=print-route]', i: 1 }, range: { sel: '#main .card', text: 'What to print' },
      before: { sel: '#main .card', text: 'Before you print' }, go: '[data-act=print]', marked: '[data-act=mark-printed]' } });
    await b.click('[data-act=print]');
    await b.waitFor(`!!document.querySelector('#layer .dialog')`);
    await b.settle(600);
    await b.shot('print-lock', { clip: '#layer .dialog', pad: 16, boxes: { ok: '#layer [data-act=dialog-ok]' } });
    await b.click('#layer [data-act=dialog-ok]');
    await b.waitFor(`S.status && !!S.status.lock`, 180000, 'printing');
    await b.settle(2500);
    await b.shot('print-locked', { clip: { x: 0, y: 0, w: 980, h: 360 }, boxes: {
      chip: '#topbar .chip', banner: '#main .banner', unlock: { sel: '#main .banner button', text: 'Unlock' },
      locks: { union: [{ sel: '#sidebar .step', text: 'Questions' }, { sel: '#sidebar .step', text: 'Papers' }] } } });
  },

  /* Scans of a pretend class of 12, made in the app's container from the printed papers. */
  async scans() {
    const out = scanDir();
    const names = Object.fromEntries(CLASS.map((s, i) => [String(i + 1), `${s[2]} ${s[1]}`]));
    const opts = { copies: 12, code_base: 1000, code_override: { 9: '1019' }, names, class: '8A', seed: Number(process.env.GUIDE_SCAN_SEED || 11),
      abilities: [0.92, 0.55, 0.78, 0.85, 0.4, 0.7, 0.62, 0.95, 0.5, 0.81, 0.3, 0.66],
      faint: [2, 6], blank_after: [6, 2], late: [12, 2], double: { 7: 'prime' } };
    const pdir = `/amc-web/files/MC-Projects/${USER}/${EXAM}`;
    execFileSync('docker', ['exec', CONTAINER, 'rm', '-rf', '/tmp/guide-scans']);
    const made = JSON.parse(execFileSync('docker', ['exec', '-i', CONTAINER, '/venv/bin/python', '-', pdir, '/tmp/guide-scans', J(opts)],
      { input: readFileSync(join(HERE, 'make_demo_scans.py')), encoding: 'utf8' }));
    execFileSync('docker', ['cp', `${CONTAINER}:/tmp/guide-scans/.`, out]);
    console.log(`  scans in ${out}: ${made.files.map((f) => f.split('/').pop()).join(', ')}`);
  },

  /* A crop of a scanned first page, to show what students do. */
  async scanSample() {
    execFileSync('docker', ['exec', CONTAINER, 'sh', '-c', 'rm -f /tmp/guide-scans/sample*; pdftoppm -r 200 -f 1 -l 1 -x 182 -y 164 -W 1382 -H 1091 -png /tmp/guide-scans/scans-8A.pdf /tmp/guide-scans/sample']);
    execFileSync('docker', ['cp', `${CONTAINER}:/tmp/guide-scans/sample-01.png`, join(HERE, '..', 'screenshots', 'scan-sample.png')]);
    console.log('  scan-sample.png');
  },

  async upload() {
    await openStep(EXAM, 'upload-scans');
    await b.shot('upload', { clip: { union: ['#main .page-header', '#main .card'] }, pad: [8, 8, 12, 8], boxes: {
      drop: '#scan-drop', photocopy: { sel: 'label.check', text: 'photocopies' } } });
    await b.setFiles('#scan-files', [join(scanDir(), 'scans-8A.pdf')]);
    await b.waitFor(`!!document.querySelector('#work')`, 15000, 'the upload');
    await sleep(900);
    await b.shot('upload-progress', { clip: '#work .work-card', pad: 16, boxes: {} }).catch((e) => console.log(`  (no progress shot: ${e.message})`));
    await b.waitFor(`!document.querySelector('#work') && S.status && S.status.scans > 0`, 240000, 'reading the scans');
    if (await b.js(`!!document.querySelector('.server-dialog')`).catch(() => false) || await b.waitFor(`!!document.querySelector('.server-dialog')`, 4000).catch(() => false)) {
      await b.settle(500);
      await b.shot('upload-message', { clip: '#layer .dialog', pad: 16, boxes: {} });
      await b.js('warn_ok(); true');
    }
    await openStep(EXAM, 'upload-scans', 2000);
    await b.shot('upload-done', { clip: { x: 0, y: 0, w: 980, h: 640 }, boxes: {
      stats: '#main .stats', next: { sel: '#main a.btn-primary', text: 'Check scans' }, badge: { sel: '#sidebar .step', text: 'Check scans' } } });
  },

  /* Only for the demo portal (not in a plain run): the class list, ready in an exam not marked yet. */
  async classList() {
    await openStep(EXAM, 'match-students', 2000);
    await b.setFiles('#list-file', [join(HERE, 'students.csv')]);
    await b.waitFor(`!!document.querySelector('#list-key')`, 20000, 'the class list');
    await b.settle(1000);
    if (await b.js(`document.querySelector('#list-key').value !== 'id'`)) await b.setValue('#list-key', 'id');
    await sleep(1200);
  },

  async check() {
    await openStep(EXAM, 'check-scans', 3500);
    await b.shot('check', { boxes: {
      stats: '#main .stats', failed: { sel: '#main .card', text: 'Unreadable pages' }, saw: '[data-act=failed-diagnose]', remove: '[data-act=failed-remove]',
      missing: { sel: '#main .card', text: 'Missing pages' }, review: { sel: '#main .card', text: 'Pages to check' }, preview: '#preview' } });
    await b.scrollTo('#main .card', 'Pages to check');
    await b.settle(800);
    await b.shot('check-review', { clip: { union: [{ sel: '#main .card', text: 'Pages to check' }, '#preview'] }, pad: 4, boxes: {
      list: '.review-list', row: '.zoom-row.is-uncertain', set: { sel: '.zoom-row.is-uncertain .seg, .zoom-row.is-uncertain .segmented', i: 0 },
      done: '[data-act=review-done]', page: '#page-svg' } });
    // What AMC saw on the blank page, then remove it.
    await b.click('[data-act=failed-diagnose]');
    await b.waitFor(`S.previewMode === 'image' && !!document.querySelector('#preview img.preview-img')`, 30000, 'what AMC saw');
    await b.settle(1500);
    await b.scroll('#main', 0);
    await b.shot('check-saw', { clip: { union: [{ sel: '#main .card', text: 'Unreadable pages' }, '#preview'] }, pad: 4, boxes: { img: '#preview img.preview-img' } });
    await b.click('[data-act=failed-remove]');
    await b.click('#layer [data-act=dialog-ok]');
    await b.waitFor(`S.scans && S.scans.failed.length === 0`, 20000, 'removing the blank page');
    // The page scanned late.
    await openStep(EXAM, 'upload-scans');
    await b.setFiles('#scan-files', [join(scanDir(), 'late-page.pdf')]);
    await b.waitFor(`!!document.querySelector('#work')`, 15000);
    await b.waitFor(`!document.querySelector('#work')`, 120000, 'reading the late page');
    if (await b.waitFor(`!!document.querySelector('.server-dialog')`, 3000).catch(() => false)) await b.js('warn_ok(); true');
    // Decide the uncertain boxes: these faint marks were meant.
    await openStep(EXAM, 'check-scans', 2500);
    for (let i = 0; i < 6 && await b.js(`S.scans.pages.some(p => p.to_check)`); i += 1) {
      await b.waitFor(`S.review && !S.review.loading`, 15000, 'a page to check');
      await b.js(`[...document.querySelectorAll('.zoom-row.is-uncertain [data-act=review-set]')].filter((x) => x.textContent.trim() === 'Ticked').forEach((x) => x.click()); true`);
      await sleep(500);
      await b.click('[data-act=review-done]');
      await sleep(2500);
    }
    await b.waitFor(`S.scans && S.scans.pages.every(p => !p.to_check) && S.scans.failed.length === 0`, 30000, 'every page settled');
    await openStep(EXAM, 'check-scans', 1500);
    await b.shot('check-clear', { clip: { x: 0, y: 0, w: 980, h: 420 }, boxes: { stats: '#main .stats', side: { sel: '#sidebar .step', text: 'Check scans' } } });
  },

  async mark() {
    await openStep(EXAM, 'mark', 2000);
    await b.shot('mark-before', { clip: { x: 250, y: 54, w: 730, h: 600 }, boxes: { list: { sel: '#main .card', i: 0 }, go: '[data-act=mark]' } });
    await b.click('[data-act=mark]');
    await sleep(1500);
    await b.waitFor(`!document.querySelector('#work') && S.status && S.status.marked`, 180000, 'the marks');
    await openStep(EXAM, 'mark', 3000);
    await b.shot('mark-done', { boxes: { cards: '#main .stats', breaking: { sel: '#main .card', text: 'break' }, again: '[data-act=mark]' } });
    await b.scrollTo('#main .card', 'How each question did');
    await b.settle(1500);
    await b.shot('mark-stats', { clip: { sel: '#main .card', text: 'How each question did' }, pad: 4, boxes: {} });
  },

  async match() {
    await openStep(EXAM, 'match-students', 2000);
    await b.shot('match-start', { clip: { x: 250, y: 54, w: 730, h: 560 }, boxes: { drop: '#list-drop' } });
    await b.setFiles('#list-file', [join(HERE, 'students.csv')]);
    await b.waitFor(`!!document.querySelector('#list-key')`, 20000, 'the class list');
    await b.settle(1000);
    if (await b.js(`document.querySelector('#list-key').value !== 'id'`)) await b.setValue('#list-key', 'id');
    await sleep(1200);
    if (await b.js(`!!document.querySelector('#assoc-code') && !document.querySelector('#assoc-code').value`)) {
      await b.js(`(() => { const s = document.querySelector('#assoc-code'); s.value = [...s.options].map(o => o.value).find(Boolean); s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
      await sleep(1200);
    }
    await b.click('[data-act=match-auto]');
    await sleep(3000);
    await openStep(EXAM, 'match-students', 2500);
    await b.shot('match-auto', { boxes: {
      list: { sel: '#main .card', text: 'Class list' }, key: '#list-key', code: '#assoc-code', auto: '[data-act=match-auto]',
      manual: { sel: '#main .card', text: 'Match by hand' } } });
    await b.scrollTo('#main .card', 'Match by hand');
    await b.setValue('#match-search', 'Arj');
    await b.settle(1200);
    await b.shot('match-manual', { clip: { sel: '#main .card', text: 'Match by hand' }, pad: 4, boxes: {
      sheets: '.review-list', name: '.namefield', code: { sel: '#main p.subtle', text: 'Code read' }, search: '#match-search',
      result: '#match-results', none: '[data-act=match-none]' } });
    await b.key('Enter', 'Enter', 13);
    await sleep(2500);
  },

  async exportMarks() {
    await openStep(EXAM, 'export-marks', 2000);
    await b.click('[data-act=export-format][data-v=CSV]');
    await b.settle(1500);
    await b.shot('export', { boxes: {
      stats: '#main .stats', hist: '#hist', format: '[data-act=export-format][data-v=CSV]', ods: '[data-act=export-format][data-v=ods]', go: '[data-act=export]' } });
    await b.scrollTo('#marks-table', null, 'center');
    await b.settle(800);
    await b.shot('export-table', { clip: { union: ['#marks-search', '#marks-table'] }, pad: [60, 16, 16, 16], boxes: { search: '#marks-search', sort: { sel: '[data-act=marks-sort]', i: 0 } } });
    await b.scroll('#main', 0);
    await b.click('[data-act=export]');
    await sleep(1500);
    await b.waitFor(`!document.querySelector('#work')`, 120000, 'the export');
    await b.settle(3000);
    await b.shot('export-done', { boxes: { preview: '#preview' } });
  },

  async annotate() {
    await openStep(EXAM, 'annotate', 2000);
    await b.setValue('[data-option=annote_position]', 'marge');
    await b.settle(1500);
    await b.shot('annotate', { boxes: {
      where: { sel: '#main .card', text: 'On each sheet' }, position: '[data-option=annote_position]', files: { sel: '#main .card', text: 'Files' },
      symbols: { sel: '#main .card', text: 'Symbols' }, all: '[data-act=annotate]' } });
    await b.click('[data-act=annotate-preview]');
    await sleep(1500);
    await b.waitFor(`!document.querySelector('#work')`, 120000, 'the preview');
    await b.settle(4000);
    await b.shot('annotate-preview', { boxes: { preview: '#preview' } });
    await b.click('[data-act=annotate]');
    await sleep(1500);
    await b.waitFor(`!document.querySelector('#work')`, 240000, 'annotating');
    await openStep(EXAM, 'annotate', 3000);
    await b.scrollTo('#main a.btn', 'Download all');
    await b.settle(800);
    await b.shot('annotate-done', { boxes: { zip: { sel: '#main a.btn', text: 'Download all' } } });
  },

  /* A bank made from the Question banks page and filled from an RJ-style LaTeX file. */
  async banks() {
    await b.goto('/banks');
    await b.waitFor(`S.route.kind === 'banks' && Array.isArray(S.banks)`, 20000, 'the banks page');
    await b.settle();
    await b.shot('banks-empty', { clip: '#main .page', pad: [0, 0, 8, 0], boxes: { new: '[data-act=bank-new]', import: '[data-act=bank-zip-import]', trash: '[data-act=trash-open]' } });
    await b.click('[data-act=bank-new]');
    await b.waitFor(`!!document.querySelector('#layer input[name=name]')`);
    await b.setValue('#layer input[name=name]', BANK);
    await b.setValue('#layer input[name=description]', 'Questions for the Class 8 unit tests');
    await b.settle(500);
    await b.shot('bank-new', { clip: '#layer .dialog', pad: 16, boxes: { name: '#layer input[name=name]', ok: '#layer button[type=submit]' } });
    await b.click('#layer button[type=submit]');
    await b.waitFor(`S.route.kind === 'bank' && S.route.name === ${J(BANK)}`, 20000, 'the new bank');
    await b.settle(1500);
    await b.click('[data-act=bank-import]');
    await b.waitFor(`!!document.querySelector('#bank-import-files')`);
    await b.settle(400);
    await b.shot('bank-import', { clip: '#layer .dialog', pad: 16, boxes: { file: '#bank-import-files', go: '[data-act=bank-import-go]' } });
    await b.setFiles('#bank-import-files', [join(HERE, 'bank-questions.tex')]);
    await b.click('[data-act=bank-import-go]');
    await b.waitFor(`!document.querySelector('#bank-import-files')`, 60000, 'the import');
    // Titles for the groups, and a difficulty and tags for each question.
    const titles = { arithmetic: 'Arithmetic', geometry: 'Geometry', algebra: 'Algebra' };
    const bankUrl = `/ui/api/bank/${enc(BANK)}`;
    for (const [g, title] of Object.entries(titles)) await api(`${bankUrl}/groups`, { op: 'describe', group: g, title });
    const meta = { percent: ['easy', 'percentages'], lcm: ['medium', 'factors'], divisible: ['easy', 'divisibility'], 'square-root': ['medium', 'roots'],
      'right-angle': ['easy', 'angles'], perimeter: ['easy', 'perimeter'], radius: ['easy', 'circles'], symmetry: ['medium', 'symmetry'],
      simplify: ['easy', 'expressions'], substitute: ['hard', 'expressions'], 'five-more': ['medium', 'expressions'], 'solve-x': ['medium', 'equations'] };
    const data = await getApi(bankUrl);
    for (const f of data.files || []) {
      const q = f.questions && f.questions[0];
      const m = q && meta[q.id];
      if (m) await api(`${bankUrl}/items`, { op: 'describe', item: f.item, difficulty: m[0], tags: `${m[1]}, class-8` });
    }
    await b.goto(`/bank/${enc(BANK)}`);
    await b.waitFor(`S.route.kind === 'bank' && !!document.querySelector('.q-item')`, 20000, 'the bank page');
    await b.click('.q-item', 'perimeter');
    await b.settle(1500);
    await b.shot('bank-page', { boxes: {
      list: '#q-list', groups: { sel: '#q-list .q-group', i: 1 }, form: '#q-form', meta: '#q-form .b-meta', search: '#main .b-filters',
      history: { sel: '#main button', text: 'History' } } });
  },

  /* A second exam, filled from the bank. */
  async fromBank() {
    await wizardDetails(EXAM2, '8A', 'Mathematics', '2026-12-15');
    await wizardPick('school', 'blank');
    await b.click('[data-act=wiz-next]');
    await b.waitFor(`!!document.querySelector('#wiz-code')`);
    await b.setValue('[data-wiz=copies]', '14');
    await wizardCreate(EXAM2);
    for (const it of ['example-single', 'example-multiple']) await api('/ui/api/items', { op: 'delete', item: it });
    await openStep(EXAM2, 'questions');
    await b.click('[data-act=bank-pick]');
    await b.waitFor(`!!document.querySelector('#bp-bank') && S.bp && S.bp.data && !!document.querySelector('.bp-row')`, 20000, 'the picker');
    await b.settle(800);
    await b.shot('picker', { clip: '#layer .dialog', pad: 16, boxes: {
      bank: '#bp-bank', group: '#bp-group', modes: '.bp-modes', list: '#bp-listhost', add: '[data-act=bp-add]' } });
    await b.click('[data-act=bp-add]'); // Arithmetic, as a new section
    await b.waitFor(`!document.querySelector('#bp-bank')`, 30000, 'adding the group');
    await sleep(1500);
    // Two geometry questions, ticked, into the starter's section.
    await b.click('[data-act=bank-pick]');
    await b.waitFor(`S.bp && S.bp.data && !!document.querySelector('.bp-row')`, 20000);
    await b.setValue('#bp-group', 'geometry');
    await sleep(800);
    await b.click('input[name=bp-mode][value=ticked]');
    await sleep(600);
    await b.js(`(() => { const s = document.querySelector('#bp-section'); if (s) { s.value = 'general'; s.dispatchEvent(new Event('change', {bubbles: true})); } return true; })()`);
    await sleep(600);
    for (const id of ['perimeter', 'radius']) await b.click('.bp-row', id).catch(() => null);
    await b.settle(600);
    await b.shot('picker-ticked', { clip: '#layer .dialog', pad: 16, boxes: { mode: { sel: '.bp-modes label', text: 'ticked' }, ticks: { union: [{ sel: '.bp-row', text: 'perimeter' }, { sel: '.bp-row', text: 'radius' }] }, add: '[data-act=bp-add]' } });
    await b.click('[data-act=bp-add]');
    await b.waitFor(`!document.querySelector('#bp-bank')`, 30000, 'adding the ticked questions');
    await sleep(1500);
    await openStep(EXAM2, 'questions');
    await b.click('.q-item', 'perimeter');
    await b.settle(800);
    await b.click('[data-act=bank-save-item]');
    await b.waitFor(`!!document.querySelector('#layer .dialog')`);
    await b.settle(800);
    await b.shot('save-to-bank', { clip: '#layer .dialog', pad: 16, boxes: {} });
    await b.click('#layer [data-act=dialog-cancel]');
  },

  /* A blueprint in "From a bank", shown but not added. */
  async blueprint() {
    await openStep(EXAM2, 'questions');
    await b.click('.q-tabs button', 'Questions');
    await b.waitFor(`!!document.querySelector('[data-act=bank-pick]')`, 15000, 'the form');
    await b.click('[data-act=bank-pick]');
    await b.waitFor(`S.bp && S.bp.data && !!document.querySelector('.bp-row')`, 20000);
    await b.click('input[name=bp-mode][value=blueprint]');
    await sleep(800);
    await b.js(`(() => { const r = document.querySelector('.bp-blue-row'); const sel = [...r.querySelectorAll('select')]; const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('change', {bubbles: true})); }; const c = r.querySelector('input'); c.value = '2'; c.dispatchEvent(new Event('input', {bubbles: true})); c.dispatchEvent(new Event('change', {bubbles: true})); if (sel[0]) set(sel[0], 'medium'); if (sel[1]) set(sel[1], 'algebra'); return true; })()`);
    await sleep(800);
    await b.click('[data-act=bp-pick]');
    await b.waitFor(`S.bp && S.bp.chosenInfo && !!document.querySelector('#bp-listhost .bp-row')`, 20000, 'the pick');
    await b.settle(1500);
    await b.shot('picker-blueprint', { clip: '#layer .dialog', pad: 16, boxes: { rows: '.bp-blue', pick: '[data-act=bp-pick]', chosen: '#bp-listhost' } });
    await b.click('#layer [data-act=dialog-cancel]');
  },

  /* The bank's question changes: the exam's copy says so, and the two are compared. */
  async copies() {
    await b.goto(`/bank/${enc(BANK)}`);
    await b.waitFor(`S.route.kind === 'bank' && !!document.querySelector('.q-item')`, 20000);
    await b.click('.q-item', 'perimeter');
    await b.waitFor(`!!document.querySelector('#qf-text')`);
    await b.setValue('#qf-text', 'A square has sides of 6 cm. What is its perimeter, in centimetres?');
    await sleep(3000);
    await openStep(EXAM2, 'questions', 2000);
    await b.click('.q-item', 'perimeter');
    await b.settle(1500);
    await b.shot('copies-status', { clip: '#q-editor', pad: [70, 10, 10, 10], boxes: {
      strip: { sel: '#main .banner', text: 'banks' }, badge: { sel: '.q-item *', text: 'Bank updated', smallest: true }, compare: '[data-act=copy-compare]',
      origin: { sel: '#q-form *', text: 'A copy from the bank', smallest: true } } });
    await b.click('[data-act=copy-compare]');
    await b.waitFor(`!!document.querySelector('#layer .dialog [data-act=copy-op]')`, 15000, 'the comparison');
    await b.settle(800);
    await b.shot('compare', { clip: '#layer .dialog', pad: 16, boxes: { diff: '#layer .dialog-body', take: '[data-op=take]', keep: '[data-op=keep]' } });
    await b.click('[data-op=take]');
    await sleep(2000);
    if (await b.has('#layer .dialog')) await b.click('#layer [data-act=dialog-cancel]').catch(() => null);
  },

  async paperDesign() {
    await openStep(EXAM2, 'questions');
    await b.click('.q-tabs button', 'Paper builder');
    await b.waitFor(`S.design && !document.querySelector('#main .skeleton')`, 20000, 'paper design');
    await b.settle(1500);
    await b.shot('paper-design', { boxes: { add: { sel: '#main button', text: 'Add a section' }, breaks: { union: [{ sel: '#main *', text: 'Page breaks', smallest: true }, { sel: '#main label', text: 'first section starts' }] }, edit: { sel: '#main button', text: 'Edit' }, frombank: { sel: '#main button', text: 'From a bank' } } });
    await b.click('.q-tabs button', 'Questions');
  },

  async bankSearch() {
    await b.goto('/banks');
    await b.waitFor(`S.route.kind === 'banks' && !!document.querySelector('#bk-search')`, 20000);
    await b.setValue('#bk-search', 'square');
    await b.settle(2000);
    await b.shot('bank-search', { clip: '#main .page', pad: [0, 0, 8, 0], boxes: { search: '#bk-search', results: '#bk-results', card: '#main .exam-card' } });
  },

  async templates() {
    await wizardDetails(OLY, '8A', 'Mathematics', '2027-01-10');
    await wizardPick('en', 'separate');
    await b.shot('gallery-amc', { boxes: { groups: '.segmented', card: '.tpl-card[data-id=separate]', preview: '.tpl-preview .tpl-pdf' } });
    await b.click('[data-act=wiz-group][data-v=school]');
    await b.click('.tpl-card[data-id=builder]');
    await b.settle(2500);
    await b.click('[data-act=wiz-next]');
    await b.waitFor(`!!document.querySelector('[data-act=pb-wiz-preset]')`, 15000, 'the builder options');
    await b.settle(800);
    await b.shot('wiz-builder', { clip: '#main .page', pad: [0, 0, 8, 0], boxes: {
      kind: '.wiz-paper .style-choices', presets: '.b-presets', fields: '.wiz-paper .form-grid', versions: '[data-bw=versions]', codes: '[data-bw="codes.style"]' } });
    await wizardCreate(OLY);
    await openStep(OLY, 'questions');
    await b.click('.q-tabs button', 'Paper builder');
    await b.waitFor(`!!document.querySelector('[data-act=pb-select]')`, 30000, 'the paper builder');
    await b.settle(2500);
    await b.click('[data-act=pb-select]', 'Title').catch(() => b.click('[data-act=pb-select]'));
    await b.settle(1200);
    await b.shot('builder', { boxes: { tabs: '.b-tabs', row: '.b-row-bar', block: { sel: '.b-cell', text: 'Title lines' }, side: '.b-side', canvas: '.b-canvas' } });
    await b.click('[data-act=pb-tab]', 'Answer sheet').catch(() => null);
    await b.settle(2000);
    await b.shot('builder-omr', { boxes: {} });
  },

  async history() {
    await openStep(EXAM, 'questions');
    await b.js(`openHistory(); true`);
    await b.waitFor(`S.history && !S.history.loading && S.history.versions && S.history.versions.length > 2`, 20000, 'History');
    await b.click('[data-act=preview-max]');
    await sleep(600);
    // A version that changed the questions: its changes in words and line by line.
    await b.js(`(() => { const v = S.history.versions.find((x) => /edited as LaTeX/.test(x.what)) || S.history.versions[2]; pickVersion(v.id); return true; })()`);
    await b.waitFor(`S.history.detail && !S.history.detail.loading`, 20000, 'a version').catch(() => null);
    await b.settle(2000);
    await b.shot('history', { boxes: { list: '#preview .hist-row.is-selected', file: '#hist-file', restore: { sel: '#preview button', text: 'Restore the exam' },
      undo: { sel: '#preview button', text: 'Undo this change' }, name: { sel: '#preview button', text: 'Name this version' }, build: { sel: '#preview button', text: 'Build this version' },
      withhist: { sel: '#preview a', text: 'With history' } } });
    await b.click('[data-act=preview-max]');
  },

  async trash() {
    const name = 'Old practice test';
    await b.js(`S.creating = ${J(name)}; socket_emit('create-project-template', [${J(name)}, 'en/simple']); true`);
    await b.waitFor(`S.project === ${J(name)} && !!S.status`, 60000, 'the throwaway exam');
    await sleep(1000);
    await b.js(`socket_emit('project-delete', ${J(name)}); true`);
    await b.waitFor(`fetch('/ui/api/projects', {cache: 'no-store'}).then(r => r.json()).then(r => !r.projects.some(p => p.name === ${J(name)}))`, 30000);
    await b.goto('/exams');
    await b.waitFor(`!!document.querySelector('.exam-card')`, 20000);
    await b.click('[data-act=trash-open]');
    await b.waitFor(`!!document.querySelector('#layer .dialog')`);
    await b.settle(1500);
    await b.shot('trash', { clip: '#layer .dialog', pad: 16, boxes: { restore: { sel: '#layer button', text: 'Restore' } } });
    await b.click('#layer [data-act=dialog-cancel]').catch(() => b.key('Escape', 'Escape', 27));
    const tr = await getApi('/ui/api/trash');
    for (const x of (tr.items || []).filter((i) => i.name === name)) await api('/ui/api/trash/delete', { id: x.id });
  },

  async dashboard() {
    await b.goto('/exams');
    await b.waitFor(`!!document.querySelector('.exam-card')`, 20000);
    await b.settle(1500);
    await b.shot('dash', { clip: { x: 0, y: 0, w: 1440, h: 420 }, boxes: {
      search: '#dash-search', filters: { union: ['#dash-class', '#dash-sort'] }, card: { sel: '.exam-card', text: EXAM },
      chip: { sel: '.exam-card .chip', i: 0 }, bar: { sel: '.exam-card .steps-bar', i: 0 }, next: { sel: '.exam-card .exam-next', i: 0 },
      menu: { sel: '.exam-card [data-act=menu]', i: 0 }, newexam: '#main a.btn-primary[href="/new"]' } });
  },

  async guide() {
    await openStep(EXAM, 'check-scans');
    await b.click('#topbar [data-menu=guide]');
    await sleep(400);
    await b.shot('guide-menu', { clip: { union: ['#topbar [data-menu=guide]', '#topbar .menu'] }, pad: [12, 24, 16, 24], boxes: {} });
    await b.click('#topbar .menu [data-act=guide-open]');
    await sleep(1500);
    await b.settle(1000);
    await b.shot('guide-page', { boxes: {} });
    await b.key('Escape', 'Escape', 27);
  },

  async settings() {
    await b.goto(`/exam/${enc(EXAM)}/settings`);
    await b.waitFor(`S.project === ${J(EXAM)} && !!S.status`, 20000);
    await b.settle(1500);
    await b.shot('exam-settings', { boxes: { rename: { sel: '#main button', text: 'Rename' }, details: { sel: '#main button', text: 'Save details' },
      duplicate: { sel: '#main button', text: 'Duplicate' }, bank: { sel: '#main button', text: 'Save as a bank' }, template: { sel: '#main button', text: 'Save as a template' },
      download: { sel: '#main a', text: 'Download' } } });
  },
};

const CLASS = file('students.csv').trim().split('\n').slice(1).map((l) => l.split(','));
function scanDir() {
  const d = join(tmpdir(), 'amc-guide-scans');
  execFileSync('mkdir', ['-p', d]);
  return d;
}

async function signIn() {
  await b.setValue('input[name="username"]', USER);
  await b.setValue('input[name="password"]', PASS);
  await b.js(`document.querySelector('form').submit(); true`);
  await b.waitFor(`location.pathname !== '/auth/login' && typeof socket !== 'undefined' && socket.connected`, 30000, 'signing in');
  await b.settle(1000);
}

const order = Object.keys(scenes).filter((s) => s !== 'classList');
let wanted = process.argv.slice(2);
if (!wanted.length) wanted = order;
else if (wanted.length === 1 && wanted[0].startsWith('from:')) wanted = order.slice(order.indexOf(wanted[0].slice(5)));
for (const w of wanted) if (!scenes[w]) { console.log(`No scene "${w}". Scenes: ${order.join(' ')}`); process.exit(2); }

b = await startBrowser({ base: BASE, port: Number(process.env.CDP_PORT || 9341) });
let failed = null;
try {
  await b.goto('/');
  await sleep(1500);
  if (await b.js(`location.pathname === '/auth/login'`)) await signIn();
  for (const w of wanted) {
    console.log(`${w}`);
    await scenes[w]();
  }
} catch (e) {
  failed = e;
  console.log(`FAILED: ${e.stack}`);
  try { await b.shot('_failed'); } catch { /* no page */ }
}
writeTex();
try { console.log(execFileSync('python3', ['-I', join(HERE, 'optimize.py')], { encoding: 'utf8' }).trimEnd()); } catch (e) { console.log(`  (screenshots not shrunk: ${e.message.split('\n')[0]})`); }
if (b.errors.length) console.log(`Page errors:\n  ${b.errors.slice(0, 5).join('\n  ')}`);
await b.close();
process.exit(failed ? 1 : 0);

