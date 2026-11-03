// Przeklikanie apki w Chrome bez okna (osobny profil), zrzuty ekranów telefonu i sprawdzenia.
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
const wyniki = [];
function cdp(method, params = {}) {
  const id = ++nr;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, zle) => czeka.set(id, { ok, zle }));
}
async function js(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function klik(sel) {
  const ok = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
  if (!ok) throw new Error('nie ma: ' + sel);
  await sen(300);
}
/** Prawdziwe tapnięcie palcem w środek elementu (zdarzenia dotyku, jak na telefonie). */
async function tap(sel) {
  const p = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
    let r = e.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) { e.scrollIntoView({ block: 'center' }); r = e.getBoundingClientRect(); } const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const pod = document.elementFromPoint(x, y); return { x, y, zaslonieta: !(pod && (pod === e || e.contains(pod))), co: pod ? pod.className || pod.tagName : '' }; })()`);
  if (!p) throw new Error('nie ma: ' + sel);
  if (p.zaslonieta) throw new Error(`zasłonięte (${p.co}): ${sel}`);
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sen(350);
}
async function wpisz(sel, tekst) {
  await tap(sel);
  await cdp('Input.insertText', { text: tekst });
  await sen(150);
}
/** Przeciągnięcie palcem w poziomie od środka elementu (swipe albo przesunięcie suwaka). */
async function przeciagnij(sel, dx, kroki = 10) {
  const p = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!p) throw new Error('nie ma: ' + sel);
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  for (let i = 1; i <= kroki; i++) {
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x + (dx * i) / kroki, y: p.y }] });
    await sen(20);
  }
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sen(700);
}
const wiersze = () => js(`[...document.querySelectorAll('.wiersz')].map(r => r.querySelector('.w-kg').textContent + 'x' + r.querySelector('.w-powt').textContent)`);
function sprawdz(warunek, opis) {
  wyniki.push(`${warunek ? 'OK ' : 'ŹLE'} ${opis}`);
  if (!warunek) process.exitCode = 1;
}
async function zrzut(nazwa, caly = false) {
  let clip;
  if (caly) {
    const h = await js('document.documentElement.scrollHeight');
    clip = { x: 0, y: 0, width: 390, height: Math.min(h, 2600), scale: 1 };
  }
  const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: caly, ...(clip ? { clip } : {}) });
  writeFileSync(join(OUT, nazwa + '.png'), Buffer.from(r.data, 'base64'));
}
const stan = () => js(`JSON.parse(localStorage.getItem('trening.v2') || '{}')`);
/** Ustawia zegar strony (data lokalna) i przeładowuje. */
async function zegar(data) {
  await js(`localStorage.setItem('__teraz', ${JSON.stringify(data)}); location.reload();`).catch(() => {});
  await sen(1200);
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
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: new URL(URL_APKI).origin }).catch(() => {});
  // Zegar strony: localStorage.__teraz (czas lokalny), od chwili załadowania płynie normalnie.
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const P = Date; const cel = localStorage.getItem('__teraz'); if (!cel) return; const przes = new P(cel).getTime() - P.now();
    class D extends P { constructor(...a) { super(...(a.length ? a : [P.now() + przes])); } static now() { return P.now() + przes; } }
    window.Date = D; })();` });
  await cdp('Page.navigate', { url: URL_APKI });
  await sen(1200);

  // ===== 1. Wtorek 18:30 (Dół A), poprzedni Dół A w historii =====
  await js(`localStorage.clear(); localStorage.setItem('trening.v2', JSON.stringify({ historia: [{ id: 'h1', dzienId: 'dol-a', nazwa: 'Dół A + brzuch', dataPlanu: '2026-10-27', start: 1761580800000, koniec: 1761580800000 + 55*6e4,
    cwiczenia: { 'wypychanie-na-suwnicy': { serie: [{kg:100,powt:12},{kg:100,powt:12},{kg:100,powt:12}], ocena: 'ok' }, 'brzuch-deska': { serie: [{kg:0,powt:45},{kg:0,powt:40}] } } }] }));`);
  await zegar('2026-11-03T18:30:00');
  await zrzut('01-start', true);
  sprawdz((await js(`document.querySelector('.dzien.wybrany b').textContent`)) === 'Wt', 'wtorek 18:30: domyślnie Wt (Dół A)');
  const propStart = await js(`[...document.querySelectorAll('.podglad li')].map(li => li.querySelector('.prop-l')?.textContent || '')`);
  sprawdz(propStart.length === 6 && propStart.every((x) => /^(Dziś|Start): /.test(x)), `start: propozycja przy każdym ćwiczeniu (${propStart.length})`);
  sprawdz(propStart[0] === 'Dziś: 102,5 kg × 8 · 3 serie', `start: suwnica po 3x12 przy 100 kg: ${propStart[0]}`);
  for (const d of ['Pn', 'Czw', 'Pt']) {
    await tap(`.dzien:nth-child(${['Pn', 'Wt', 'Czw', 'Pt'].indexOf(d) + 1})`);
    const p = await js(`[...document.querySelectorAll('.podglad li')].map(li => li.querySelector('.prop-l')?.textContent || '')`);
    sprawdz(p.length > 0 && p.every((x) => /^(Dziś|Start): .+ · \d serie$/.test(x)), `${d}: propozycje przy wszystkich ${p.length} ćwiczeniach`);
  }
  await tap('.dzien:nth-child(1)');
  await zrzut('01b-start-pn-zapis-trenera', true);
  // Przesunięcie palcem w bok: dzień planu (Pn -> Wt)
  await przeciagnij('.podglad', -160);
  sprawdz((await js(`document.querySelector('.dzien.wybrany b').textContent`)) === 'Wt', 'start: przesunięcie w lewo = następny dzień');
  await sen(800);
  sprawdz((await js('window.scrollX')) === 0, 'po przesunięciu strona nie jest przewinięta w bok');
  await tap('[data-a="start"]');
  sprawdz((await js('document.querySelector("h1").textContent')) === 'Dół A + brzuch', 'po przesunięciu dnia Start działa');
  await zrzut('02-trening', true);
  sprawdz((await js(`document.querySelector('.karta-cw .prop-l').textContent`)) === 'Dziś: 102,5 kg × 8 · 3 serie', 'lista treningu: propozycja na karcie');
  await tap('[data-a="cw"][data-id="wypychanie-na-suwnicy"]');
  await zrzut('03-cwiczenie-suwaki');
  let w = await wiersze();
  sprawdz(JSON.stringify(w) === '["102,5x8","102,5x8","102,5x8"]', `3 wiersze wypełnione propozycją na dziś: ${w}`);
  const prop = await js(`document.querySelector('.propozycja b').textContent`);
  sprawdz(prop === '102,5 kg × 8 powt.', `propozycja po 3x12 przy 100 kg: ${prop}`);
  sprawdz(await js(`document.querySelector('.propozycja').classList.contains('wstawiona')`), 'propozycja już wstawiona');
  sprawdz((await js(`document.querySelector('.linijka[data-p="kg"] .on').textContent`)) === '102,5', 'suwak kg ustawiony na 102,5');
  const srodek = await js(`(() => { const l = document.querySelector('.linijka[data-p="kg"]'), b = l.querySelector('.on'); const a = l.getBoundingClientRect(), c = b.getBoundingClientRect(); return Math.round((c.x + c.width / 2) - (a.x + a.width / 2)); })()`);
  sprawdz(Math.abs(srodek) <= 2, `zaznaczona wartość na środku suwaka (przesunięcie ${srodek} px)`);
  // +2,5 kg przyciskiem, powtórzenia przesunięciem suwaka o jedną pozycję (9)
  await tap('.wiersz[data-i="0"] [data-a="krok"][data-p="kg"][data-o="2.5"]');
  await przeciagnij('.linijka[data-p="powt"][data-i="0"]', -64);
  const pPowt = await js(`document.querySelector('.linijka[data-p="powt"] .on').textContent`);
  sprawdz(pPowt === '9', `przesunięcie suwaka powtórzeń o 1 pozycję: ${pPowt}`);
  if (pPowt !== '9') await tap('.linijka[data-p="powt"][data-i="0"] [data-v="9"]');
  sprawdz((await js(`document.querySelector('#glowny-opis').textContent`)) === '105 kg × 9 powt.', 'dolny przycisk pokazuje 105 kg × 9');
  sprawdz(JSON.stringify(await wiersze()) === '["105x9","102,5x8","102,5x8"]', 'wiersz 1 pokazuje nowe liczby');
  await zrzut('03b-suwak-zmieniony');
  // Przewinięcie przed odhaczeniem: ekran ma zostać w miejscu
  await js('window.scrollTo(0, 120)');
  const y0 = await js('window.scrollY');
  await tap('#glowny-seria');
  await sen(1200);
  const y1 = await js('window.scrollY');
  const widac = await js(`(() => { const r = document.querySelector('.wiersz.akt .w-gl').getBoundingClientRect(); return r.top >= 0 && r.bottom <= document.querySelector('#przerwa').getBoundingClientRect().top; })()`);
  sprawdz(y1 >= y0 && y1 - y0 < 500 && widac, `po odhaczeniu ekran nie wraca na górę, następna seria widoczna nad przerwą (scrollY ${y0} -> ${y1})`);
  await zrzut('04-po-serii-1-przerwa');
  sprawdz(!(await js(`document.querySelector('#przerwa').hidden`)), 'przerwa ruszyła');
  w = await wiersze();
  sprawdz(JSON.stringify(w) === '["105x9","105x9","105x9"]', `zmieniona seria 1 przeszła na dalsze: ${w}`);
  sprawdz((await js(`document.querySelector('.wiersz.akt').dataset.i`)) === '1', 'po odhaczeniu suwaki są przy serii 2');
  // Seria 2: inny ciężar wpisany ręcznie (z przecinkiem), odhaczona ptaszkiem w wierszu
  await tap('.wiersz[data-i="1"] [data-a="wpisz"][data-p="kg"]');
  await cdp('Input.insertText', { text: '107,5' });
  await klik('dialog button[value="tak"]');
  sprawdz(JSON.stringify(await wiersze()) === '["105x9","107,5x9","105x9"]', 'ręcznie wpisane 107,5 kg');
  await tap('.wiersz[data-i="1"] .ptak');
  // Seria 3: dostała liczby z serii 2, odhaczona dolnym przyciskiem
  await tap('#glowny-seria');
  for (let i = 0; i < 9; i++) await tap('#przerwa [data-a="przerwa"][data-o="-15"]').catch(() => {});
  await sen(900);
  await zrzut('05-wszystkie-serie-koniec-przerwy');
  let s = await stan();
  sprawdz(JSON.stringify(s.aktywny.cwiczenia['wypychanie-na-suwnicy'].serie.map((x) => [x.kg, x.powt, x.z])) === '[[105,9,true],[107.5,9,true],[107.5,9,true]]', 'zapis per seria w localStorage');
  // Cofnięcie odhaczenia ptaszkiem i ponowne odhaczenie
  await tap('.wiersz[data-i="2"] .ptak');
  sprawdz(!(await stan()).aktywny.cwiczenia['wypychanie-na-suwnicy'].serie[2].z, 'odznaczenie serii');
  await tap('.wiersz[data-i="2"] .ptak');
  await tap('[data-a="ocena"][data-k="ok"]');
  // Następne ćwiczenie: bez historii -> propozycja startowa
  await tap('#dol [data-a="cw"]');
  await zrzut('06-nowe-cwiczenie-start', true);
  const pStart = await js(`document.querySelector('.propozycja').innerText`);
  sprawdz(/Propozycja startowa/i.test(pStart) && /12,5 kg/.test(pStart) && /sprawdź na serii rozgrzewkowej/.test(pStart), 'RDL: propozycja startowa 12,5 kg');
  sprawdz((await js(`document.querySelector('.s-gora').textContent`)).includes('na hantel'), 'RDL: kg na hantel');
  sprawdz((await js('document.querySelectorAll(".anim img").length')) === 2 && !(await js('document.querySelector(".anim").classList.contains("mala")')), 'RDL: duża ilustracja (2 klatki)');
  // Przesunięcia w bok między ćwiczeniami
  await przeciagnij('.tytul-cw', 170);
  sprawdz((await js(`document.querySelector('h1').textContent`)) === '1 z 6', 'przesunięcie w prawo = poprzednie ćwiczenie');
  await przeciagnij('.tytul-cw', -170);
  sprawdz((await js(`document.querySelector('h1').textContent`)) === '2 z 6', 'przesunięcie w lewo = następne ćwiczenie');
  await przeciagnij('.tytul-cw', -40);
  sprawdz((await js(`document.querySelector('h1').textContent`)) === '2 z 6', 'krótki ruch palcem nie zmienia ćwiczenia');
  await tap('.nav-cw.prawo');
  sprawdz((await js(`document.querySelector('h1').textContent`)) === '3 z 6', 'strzałka › = następne ćwiczenie');
  await tap('.nav-cw.lewo');
  await tap('#glowny-seria');
  // Seria wybrana na suwaku, ale nieodhaczona
  await tap('.linijka[data-p="kg"][data-i="1"] [data-v="15"]');
  await tap('[data-a="pomin"]').catch(() => {});
  await tap('.wstecz');
  await zrzut('07-lista', true);
  await tap('[data-a="zakoncz"]');
  await zrzut('08-pytanie-nieodhaczone');
  sprawdz((await js(`document.querySelector('dialog h3').textContent`)).includes('nieodhaczona'), 'pytanie o wpisaną, nieodhaczoną serię');
  await klik('dialog button[value="tak"]');
  await klik('dialog button[value="tak"]');
  await zrzut('09-podsumowanie', true);
  const tekst = await js(`document.querySelector('#tekst').textContent`);
  console.log('--- podsumowanie ---\n' + tekst + '\n---');
  sprawdz(tekst.startsWith('Byłem: Wtorek: Dół A + brzuch (03.11.2026)'), 'nagłówek podsumowania');
  sprawdz(tekst.includes('Wypychanie na suwnicy: 9x105 kg, 9x107,5 kg, 9x107,5 kg · ok'), 'różne serie osobno');
  sprawdz(tekst.includes('Martwy ciąg rumuński z hantlami: 8x12,5 kg, 8x15 kg'), 'seria zaliczona z pytania');
  // Kopiowanie: schowek
  await tap('[data-a="kopiuj"]');
  const schowek = await js('navigator.clipboard.readText()').then((x) => x.replace(/\r\n/g, '\n')).catch((e) => 'BŁĄD ' + e.message);
  const toastKop = await js(`document.querySelector('#toast').textContent`);
  sprawdz(toastKop.startsWith('Skopiowane'), `Kopiuj podsumowanie: komunikat "${toastKop}"`);
  sprawdz(schowek === tekst, `Kopiuj podsumowanie -> schowek (odczyt: ${schowek === tekst ? 'zgodny' : JSON.stringify(String(schowek).slice(0, 80))})`);
  // Kopiowanie bez API schowka i bez execCommand: tekst zaznaczony na ekranie
  await js(`Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); document.execCommand = () => false;`);
  await tap('[data-a="kopiuj"]');
  const zazn = await js('String(window.getSelection())');
  sprawdz(zazn.trim() === tekst.trim(), 'gdy kopiowanie zablokowane: tekst zaznaczony do ręcznego skopiowania');
  sprawdz((await js(`document.querySelector('#toast').textContent`)).includes('przytrzymaj'), 'komunikat o ręcznym kopiowaniu');
  await zrzut('10-kopiowanie-reczne');
  // Następny trening Dół A: propozycja z zapisu (wszystkie 9 przy 105/107,5 w zakresie 8-12 -> 107,5 x 10)
  await zegar('2026-11-10T18:30:00');
  await tap('[data-a="start"]');
  await tap('[data-a="cw"][data-id="wypychanie-na-suwnicy"]');
  const p2 = await js(`document.querySelector('.propozycja b').textContent`);
  sprawdz(p2 === '107,5 kg × 10 powt.', `tydzień później propozycja z historii: ${p2}`);
  sprawdz(JSON.stringify(await wiersze()) === '["107,5x10","107,5x10","107,5x10"]', 'tydzień później wiersze z propozycji');
  await zrzut('11-tydzien-pozniej');

  // ===== 2. Noc z poniedziałku na wtorek =====
  await js(`localStorage.clear()`);
  await zegar('2026-11-03T00:30:00');
  await zrzut('20-wtorek-0030-start');
  sprawdz((await js(`document.querySelector('.dzien.wybrany b').textContent`)) === 'Pn', 'wtorek 0:30: domyślnie Pn (Góra A)');
  sprawdz((await js(`document.querySelector('.witaj small').textContent`)).startsWith('Poniedziałek, 2 listopada (po północy)'), 'data dnia planu na starcie');
  // Trening zaczęty w poniedziałek 23:50, po północy dalej ten sam
  await js(`localStorage.clear()`);
  await zegar('2026-11-02T23:50:00');
  await tap('[data-a="start"]');
  await tap('[data-a="cw"][data-id="wyciskanie-sztangi-na-lawce-poziomej"]');
  await zrzut('21-lawka-znane-wyniki');
  const pL = await js(`document.querySelector('.propozycja b').textContent`);
  sprawdz(pL === '52,5 kg × 6 powt.', `ławka po 3x12 przy 50 (zapis Trenera): ${pL}`);
  w = await wiersze();
  sprawdz(JSON.stringify(w) === '["52,5x6","52,5x6","52,5x6"]', `ławka: wiersze z propozycji po zapisie Trenera: ${w}`);
  await tap('#glowny-seria');
  await zegar('2026-11-03T00:30:00');
  sprawdz((await js(`document.querySelector('h1').textContent`)) === 'Góra A + brzuch', 'po przeładowaniu o 0:30 trening dalej trwa');
  await tap('[data-a="cw"][data-id="wyciskanie-sztangi-na-lawce-poziomej"]');
  sprawdz((await js(`document.querySelectorAll('.wiersz.z').length`)) === 1, 'odhaczona przed północą seria nie zniknęła');
  await tap('#glowny-seria');
  await tap('#glowny-seria');
  await tap('.wstecz');
  await tap('[data-a="zakoncz"]');
  await klik('dialog button[value="tak"]');
  const t2 = await js(`document.querySelector('#tekst').textContent`);
  console.log('--- podsumowanie nocne ---\n' + t2 + '\n---');
  sprawdz(t2.startsWith('Byłem: Poniedziałek: Góra A + brzuch (02.11.2026)'), 'trening o 0:30 zapisany jako poniedziałek 2.11');
  sprawdz(t2.includes('Wyciskanie sztangi na ławce poziomej: 3x6 · 52,5 kg'), 'identyczne serie scalone');
  await tap('[data-a="dom"]');
  sprawdz((await js(`document.querySelector('.dzien.zrobiony b')?.textContent`)) === 'Pn', 'po treningu Pn ma ✓');
  await zrzut('22-start-po-nocnym', true);
  // Ustawienia
  await tap('[data-a="historia"]');
  await tap('details.wpis-hist summary');
  await zrzut('23-historia', true);
  await tap('[data-a="ustawienia"]');
  await zrzut('24-opcje');
  // Cele dotykowe: przyciski w ekranie ćwiczenia co najmniej 44 px
  await zegar('2026-11-05T18:30:00');
  await tap('[data-a="start"]');
  await tap('.karta-cw[data-a="cw"]');
  const male = await js(`[...document.querySelectorAll('#app button, #app input, #przerwa button')].filter(e => e.offsetParent && !e.closest('details:not([open])')).map(e => { const r = e.getBoundingClientRect(); return [e.textContent.trim().slice(0, 20) || e.dataset.a, Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44)`);
  sprawdz(male.length === 0, `cele dotykowe >= 44 px (za małe: ${JSON.stringify(male)})`);
  await zrzut('25-czwartek-gora-b');
} catch (e) {
  console.error('BŁĄD:', e.message);
  process.exitCode = 1;
} finally {
  bledy.splice(0, bledy.length, ...bledy.filter((b) => !/navigator\.vibrate/.test(b)));
  console.log(wyniki.join('\n'));
  if (bledy.length) { console.error('Błędy strony:\n' + bledy.join('\n')); process.exitCode = 1; }
  try { ws?.close(); } catch { /* */ }
  chrome.kill();
}
