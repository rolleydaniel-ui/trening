// Przeklikanie apki w Chrome bez okna (osobny profil) i zrzuty ekranów telefonu.
// node narzedzia/zrzuty.mjs <folder-na-zrzuty>   (wymaga działającego narzedzia/serwer.mjs)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.argv[2] || join(tmpdir(), 'trening-zrzuty');
const URL_APKI = process.env.URL_APKI || 'http://localhost:8123/';
const PORT = 9339;
mkdirSync(OUT, { recursive: true });

const profil = mkdtempSync(join(tmpdir(), 'trening-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profil}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sen = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
let nr = 0;
const czeka = new Map();
const bledy = [];
function cdp(method, params = {}) {
  const id = ++nr;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, zle) => czeka.set(id, { ok, zle }));
}
async function js(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function klik(sel) {
  const ok = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
  if (!ok) throw new Error('nie ma: ' + sel);
  await sen(350);
}
async function zrzut(nazwa, caly = false) {
  let clip;
  if (caly) {
    const h = await js('document.documentElement.scrollHeight');
    clip = { x: 0, y: 0, width: 390, height: Math.min(h, 2400), scale: 1 };
  }
  const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: caly, ...(clip ? { clip } : {}) });
  writeFileSync(join(OUT, nazwa + '.png'), Buffer.from(r.data, 'base64'));
  console.log('zrzut', nazwa);
}

try {
  let cel;
  for (let i = 0; i < 50 && !cel; i++) {
    await sen(200);
    try { cel = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* jeszcze startuje */ }
  }
  ws = new WebSocket(cel.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && czeka.has(d.id)) { const c = czeka.get(d.id); czeka.delete(d.id); d.error ? c.zle(new Error(d.error.message)) : c.ok(d.result); }
    if (d.method === 'Runtime.exceptionThrown') bledy.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') bledy.push(d.params.args.map((a) => a.value || a.description).join(' '));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') bledy.push(d.params.entry.text + ' ' + (d.params.entry.url || ''));
  });
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
  // Stała data: wtorek 3.11.2026, 18:30 (dzień planu: Dół A).
  const DATA = process.env.DATA || '2026-11-03T18:30:00';
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const Prawdziwa = Date; const przes = new Prawdziwa(${JSON.stringify(DATA)}).getTime() - Prawdziwa.now();
    class D extends Prawdziwa { constructor(...a) { super(...(a.length ? a : [Prawdziwa.now() + przes])); } static now() { return Prawdziwa.now() + przes; } }
    window.Date = D; })();` });
  await cdp('Page.navigate', { url: URL_APKI });
  await sen(1500);
  // Poprzedni trening w historii (żeby było "ostatnio").
  await js(`localStorage.setItem('trening.v2', JSON.stringify({ historia: [{ id: 'h1', dzienId: 'dol-a', nazwa: 'Dół A + brzuch', dataPlanu: '2026-10-27', start: Date.now() - 7*864e5, koniec: Date.now() - 7*864e5 + 55*6e4,
    cwiczenia: { 'wypychanie-na-suwnicy': { serie: [{kg:100,powt:12},{kg:100,powt:12},{kg:100,powt:12}], ocena: 'ok' }, 'brzuch-deska': { serie: [{kg:0,powt:45},{kg:0,powt:40}] } } }] })); location.reload();`).catch(() => {});
  await sen(1500);
  await zrzut('01-start', true);
  await klik('[data-a="start"]');
  await zrzut('02-trening', true);
  await klik('[data-a="cw"][data-id="wypychanie-na-suwnicy"]');
  await zrzut('03-cwiczenie', true);
  await klik('[data-a="krok"][data-p="kg"][data-o^="2"]');
  await klik('[data-a="seria"]');
  await sen(1300);
  await zrzut('04-przerwa');
  // Druga seria z innym ciężarem (wpisanym ręcznie).
  await js(`(() => { const k = document.querySelector('#kg'); k.value = '110'; k.dispatchEvent(new Event('input', { bubbles: true })); const p = document.querySelector('#powt'); p.value = '9'; p.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await klik('[data-a="seria"]');
  await klik('[data-a="seria"]');
  for (let i = 0; i < 9; i++) await klik('#duza-przerwa [data-a="przerwa"][data-o="-15"]');
  await sen(800);
  await zrzut('05-po-celu-koniec-przerwy', true);
  await klik('[data-a="edytuj"][data-i="0"]');
  await zrzut('06-edycja', true);
  await klik('[data-a="anuluj-edycje"]');
  await klik('[data-a="cw"]'); // Dalej: następne ćwiczenie
  await zrzut('07-nastepne');
  await klik('[data-a="seria"]');
  await klik('[data-a="lista"]');
  await zrzut('08-lista-z-paskiem-przerwy', true);
  await klik('[data-a="zakoncz"]');
  await zrzut('09-pytanie-o-koniec');
  await klik('dialog button[value="tak"]');
  await zrzut('10-podsumowanie', true);
  await klik('[data-a="dom"]');
  await zrzut('11-start-po', true);
  await klik('[data-a="historia"]');
  await klik('details.wpis-hist summary');
  await zrzut('12-historia', true);
  await klik('[data-a="ustawienia"]');
  await zrzut('13-opcje');
  const tekst = await js(`JSON.parse(localStorage.getItem('trening.v2')).historia.length`);
  console.log('treningi w historii:', tekst);
} catch (e) {
  console.error('BŁĄD:', e.message);
  process.exitCode = 1;
} finally {
  bledy.splice(0, bledy.length, ...bledy.filter((b) => !/navigator\.vibrate/.test(b)));
  if (bledy.length) { console.error('Błędy strony:\n' + bledy.join('\n')); process.exitCode = 1; }
  try { ws?.close(); } catch { /* */ }
  chrome.kill();
}
