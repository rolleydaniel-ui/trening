import { PLAN, START_TRENINGU } from './plan.js';
import {
  parsujCel, przerwaSekundy, dzienPlanu, formatKg, formatCzas, formatCzasTrwania, seriaTekst, serieTekst,
  ostatnio, dataISO, propozycja, wierszeStartowe, odhaczSerie, aktywnaSeria, tydzienPlanu,
  podsumowanie, statystyki, rekordy, listaCwiczen, OCENY, propozycjaKrotko, wartosciKg, wartosciPowt, ileSerii,
} from './logika.js';

// ---------- Stan i zapis ----------
const KLUCZ = 'trening.v2';
const DOMYSLNE = { aktywny: null, historia: [], ustawienia: { dzwiek: true, wibracje: true, ekran: true, przerwaAuto: true, krokKg: 2.5, malyObraz: false } };

function wczytaj() {
  try {
    const s = JSON.parse(localStorage.getItem(KLUCZ) || 'null');
    if (s) return { ...DOMYSLNE, ...s, ustawienia: { ...DOMYSLNE.ustawienia, ...(s.ustawienia || {}) } };
  } catch { /* uszkodzony zapis: zaczynamy od zera */ }
  return structuredClone(DOMYSLNE);
}
let S = wczytaj();
const zapisz = () => localStorage.setItem(KLUCZ, JSON.stringify(S));

// Ciężary zapamiętane przez poprzednią wersję apki (po nazwie ćwiczenia).
let stareKg = {};
try { stareKg = JSON.parse(localStorage.getItem('last-kg') || '{}'); } catch { /* brak */ }

// Widok (nie zapisywany poza aktywnym treningiem)
let V = { ekran: S.aktywny ? 'trening' : 'start', dzienId: null, cwId: null, koniecId: null, akt: null };

const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dzien = (id) => PLAN.find((d) => d.id === id);
const teraz = () => Date.now();

function cwiczenieTreningu(t, cwId) {
  return listaCwiczen(t, PLAN).find((c) => c.id === cwId);
}
const zrobione = (t, cwId) => (t.cwiczenia[cwId]?.serie || []).filter((s) => s.z);
const ostatnioCw = (c) => ostatnio(S.historia, c.id, c.znane);

/** Propozycja na dany dzień planu (data ISO): z historii, zapisu Trenera albo ciężar startowy. */
function propozycjaCw(dataPlanu, c) {
  const startKg = stareKg[c.nazwa]?.kg ? Number(stareKg[c.nazwa].kg) : c.startKg;
  return propozycja({ ost: ostatnioCw(c), cel: parsujCel(c.cel), startKg, krok: c.krok || S.ustawienia.krokKg, tydzien: tydzienPlanu(dataPlanu, START_TRENINGU) });
}

/** Wpis ćwiczenia w treningu; przy pierwszym otwarciu wiersze serii z ostatniego razu. */
function wpisCw(t, c) {
  if (!t.cwiczenia[c.id]) {
    t.cwiczenia[c.id] = { serie: wierszeStartowe({ cel: parsujCel(c.cel), ost: ostatnioCw(c), prop: propozycjaCw(t.dataPlanu, c) }), ocena: '' };
    zapisz();
  }
  return t.cwiczenia[c.id];
}

/** Kopia treningu tylko z odhaczonymi seriami (do historii i liczenia). */
function tylkoZrobione(t) {
  const cwiczenia = {};
  for (const [id, c] of Object.entries(t.cwiczenia)) {
    const serie = c.serie.filter((s) => s.z).map(({ kg, powt, t: czas }) => ({ kg, powt, t: czas }));
    if (serie.length) cwiczenia[id] = { serie, ocena: c.ocena || '' };
  }
  return { ...t, cwiczenia };
}

// ---------- Dźwięk, wibracje, ekran ----------
let audio = null;
function odblokujDzwiek() {
  if (!S.ustawienia.dzwiek) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}
function pik() {
  if (S.ustawienia.dzwiek && audio) {
    const t0 = audio.currentTime;
    [0, 0.25, 0.5].forEach((d, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = i === 2 ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
      o.connect(g).connect(audio.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.2);
    });
  }
  wibruj([250, 120, 250, 120, 500]);
}
function wibruj(w) { if (S.ustawienia.wibracje && navigator.vibrate) navigator.vibrate(w); }

let blokadaEkranu = null;
async function trzymajEkran() {
  if (!S.ustawienia.ekran || !S.aktywny || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    if (!blokadaEkranu) {
      blokadaEkranu = await navigator.wakeLock.request('screen');
      blokadaEkranu.addEventListener('release', () => { blokadaEkranu = null; });
    }
  } catch { /* np. tryb oszczędzania baterii */ }
}
function pusc() { if (blokadaEkranu) { blokadaEkranu.release(); blokadaEkranu = null; } }
document.addEventListener('visibilitychange', () => { trzymajEkran(); tyk(); });

// ---------- Toast z cofnięciem ----------
let toastTimer = null;
function toast(tekst, cofnij) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(tekst)}</span>${cofnij ? '<button data-a="cofnij">Cofnij</button>' : ''}`;
  el.hidden = false;
  el._cofnij = cofnij || null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; el._cofnij = null; }, cofnij ? 5000 : 2600);
}

// ---------- Przerwa ----------
function startPrzerwy(sek, cwId) {
  S.aktywny.przerwa = { koniec: teraz() + sek * 1000, dlugosc: sek, cwId, pikniete: false };
  zapisz();
}
function zmienPrzerwe(o) {
  const p = S.aktywny?.przerwa;
  if (!p) return;
  p.koniec = Math.max(teraz(), p.koniec + o * 1000);
  p.dlugosc = Math.max(1, p.dlugosc + o);
  p.pikniete = false;
  zapisz();
  tyk();
}
function koniecPrzerwy() {
  if (S.aktywny) { S.aktywny.przerwa = null; zapisz(); }
  tyk();
}

// Pasek przerwy jest przyklejony nad dolnymi przyciskami: nie przesuwa ekranu.
// Budowany tylko przy zmianie stanu, co 250 ms zmienia się sam tekst (przyciski się nie podmieniają pod palcem).
let ukladPrzerwy = '';
function tyk() {
  const t = S.aktywny;
  const zeg = $('#zegar-treningu');
  if (zeg && t) zeg.textContent = formatCzas((teraz() - t.start) / 1000);

  const p = t?.przerwa;
  const el = $('#przerwa');
  const widoczny = p && ['trening', 'cwiczenie'].includes(V.ekran);
  document.body.classList.toggle('z-przerwa', !!widoczny);
  if (!p) {
    el.hidden = true;
    ukladPrzerwy = '';
    document.title = t ? `Trening ${formatCzas((teraz() - t.start) / 1000)}` : 'Trening';
    return;
  }
  const zostalo = (p.koniec - teraz()) / 1000;
  const po = zostalo <= 0;
  if (po && !p.pikniete) {
    p.pikniete = true;
    zapisz();
    if (document.visibilityState === 'visible') pik();
  }
  // Po minucie od końca przerwy pasek znika sam.
  if (zostalo < -60) { koniecPrzerwy(); return; }
  const tekst = po ? `+${formatCzas(-zostalo)}` : formatCzas(Math.ceil(zostalo));
  document.title = po ? 'Czas na serię!' : `${tekst} przerwy`;
  if (!widoczny) { el.hidden = true; ukladPrzerwy = ''; return; }

  const naCw = V.ekran === 'cwiczenie' && V.cwId === p.cwId;
  const cw = cwiczenieTreningu(t, p.cwId);
  const klucz = `${po}|${naCw}|${p.cwId}`;
  if (klucz !== ukladPrzerwy) {
    ukladPrzerwy = klucz;
    el.hidden = false;
    el.classList.toggle('koniec', po);
    el.innerHTML = `<div class="p-gora"><div class="p-tekst"><small>${po ? 'Czas na serię' : 'Przerwa'}${cw && !naCw ? ' · ' + esc(cw.nazwa) : ''}</small><div class="czas" id="p-czas"></div></div>
      ${po ? '' : '<button data-a="przerwa" data-o="-15" aria-label="15 sekund krócej">−15</button><button data-a="przerwa" data-o="15" aria-label="15 sekund dłużej">+15</button>'}
      ${cw && V.ekran === 'trening' ? `<button data-a="cw" data-id="${esc(cw.id)}">Wróć</button>` : ''}
      <button data-a="pomin">${po ? 'OK' : 'Pomiń'}</button></div>
      <div class="p-pasek"><i id="p-pasek"></i></div>`;
  }
  $('#p-czas').textContent = tekst;
  $('#p-pasek').style.width = `${Math.min(100, Math.max(0, (1 - zostalo / p.dlugosc) * 100))}%`;
}
setInterval(tyk, 250);

// ---------- Ekrany ----------
function render() {
  const app = $('#app');
  const widoki = { start: ekranStart, trening: ekranTrening, cwiczenie: ekranCwiczenie, koniec: ekranKoniec, historia: ekranHistoria, ustawienia: ekranUstawienia };
  if (V.ekran === 'trening' && !S.aktywny) V.ekran = 'start';
  if (V.ekran === 'cwiczenie' && (!S.aktywny || !cwiczenieTreningu(S.aktywny, V.cwId))) V.ekran = S.aktywny ? 'trening' : 'start';
  app.innerHTML = (widoki[V.ekran] || ekranStart)();
  ustawLinijki();
  ukladPrzerwy = '';
  tyk();
  if (S.aktywny) trzymajEkran(); else pusc();
}

function idz(ekran, zmiany = {}) {
  V = { ...V, ekran, akt: null, technika: false, ...zmiany };
  if (ekran !== 'start' && history.state?.apka !== 2) history.pushState({ apka: 2 }, '');
  render();
  window.scrollTo(0, 0);
}

/** Ilustracja ćwiczenia: dwie klatki na zmianę (jak gif). */
function obrazek(c, klasa = '') {
  const z = (c.zdjecia || []).slice(0, 2);
  if (!z.length) return `<span class="obr puste ${klasa}">＋</span>`;
  return `<span class="obr ${klasa}">${z.map((s) => `<img src="${esc(s)}" alt="" loading="lazy" decoding="async">`).join('')}</span>`;
}

function ostatnioKrotko(cw) {
  const o = ostatnioCw(cw);
  return o ? serieTekst(o.serie, parsujCel(cw.cel).jednostka) : '';
}

/** "Dziś: 52,5 kg × 6 powt. · 3 serie" (bez historii: "Start: ..."). */
function linijkaPropozycji(dataPlanu, c) {
  const cel = parsujCel(c.cel);
  const p = propozycjaCw(dataPlanu, c);
  if (!p) return `<span class="prop-l">${esc(c.cel)}</span>`;
  const co = propozycjaKrotko(p, cel).replace(' powt.', '').replace('bez ciężaru × ', 'bez ciężaru, ');
  return `<span class="prop-l ${p.start ? 'start' : ''}">${p.start ? 'Start' : 'Dziś'}: ${esc(co)} · ${ileSerii(cel.serie)}</span>`;
}

function zrobioneWTygodniu(dataPlanu) {
  return new Set(S.historia.filter((h) => h.dataPlanu >= dataPlanu).map((h) => h.dzienId));
}
function dataSlownie(iso) {
  const t = new Date(iso + 'T12:00').toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
  return t[0].toUpperCase() + t.slice(1);
}

/** Data, na którą liczymy propozycję dla wybranego dnia planu: najbliższy taki dzień tygodnia (dziś albo później). */
function dataDlaDnia(d, dzisISO) {
  const x = new Date(dzisISO + 'T12:00');
  for (let i = 0; i < 7 && x.getDay() !== d.dzienTygodnia; i++) x.setDate(x.getDate() + 1);
  return dataISO(x);
}

function ekranStart() {
  const { dzis, nastepny, data, poPolnocy } = dzienPlanu(new Date(), PLAN);
  if (!V.dzienId) V.dzienId = (dzis || nastepny || PLAN[0]).id;
  const wyb = dzien(V.dzienId);
  const dataTekst = dataSlownie(data) + (poPolnocy ? ' (po północy)' : '');
  const tydzien = new Date(data + 'T12:00');
  tydzien.setDate(tydzien.getDate() - ((tydzien.getDay() + 6) % 7));
  const zrob = zrobioneWTygodniu(dataISO(tydzien));
  const tydz = tydzienPlanu(data, START_TRENINGU);
  const dataWyb = dataDlaDnia(wyb, data);

  const naglowek = dzis
    ? `<small>${esc(dataTekst)}${tydz ? ` · tydzień ${tydz}` : ''}</small><h2>${esc(dzis.nazwa)}</h2><p>Dziś według planu.</p>`
    : `<small>${esc(dataTekst)}</small><h2>Dzień wolny</h2><p>Następny według planu: ${esc(nastepny.dzien.toLowerCase())}, ${esc(nastepny.nazwa)}. Możesz też zrobić dowolny dzień.</p>`;

  const aktywny = S.aktywny
    ? `<button class="karta-cw trwa" data-a="wroc"><span class="obr puste">▶</span><span class="n"><b>Trwa: ${esc(dzien(S.aktywny.dzienId)?.nazwa || '')}</b><span>Wróć do treningu</span></span><span class="licz" id="zegar-treningu"></span></button>`
    : '';

  const lista = wyb.cwiczenia.map((c) => {
    const o = ostatnioKrotko(c);
    return `<li>${obrazek(c)}<span class="n"><b>${esc(c.nazwa)}</b>${linijkaPropozycji(dataWyb, c)}${o ? `<span>Ostatnio: ${esc(o)}</span>` : ''}</span></li>`;
  }).join('');

  return `<div class="przesuwne">
  <div class="pasek"><span style="min-width:64px"></span><h1>Trening</h1><button class="prawy" data-a="historia">Historia</button></div>
  ${aktywny}
  <div class="witaj">${naglowek}</div>
  <div class="dni">${PLAN.map((d) => `<button class="dzien ${d.id === V.dzienId ? 'wybrany' : ''} ${zrob.has(d.id) ? 'zrobiony' : ''}" data-a="dzien" data-id="${d.id}"><b>${esc(d.krotko)}</b><span>${esc(d.nazwa.replace(' + brzuch', ''))}</span></button>`).join('')}</div>
  <div class="sekcja"><h3>${esc(wyb.nazwa)} · ${wyb.cwiczenia.length} ćwiczeń</h3><span class="podpowiedz">‹ przesuń: inny dzień ›</span></div>
  <div class="podglad"><ul>${lista}</ul></div>
  </div>
  <div class="dolny"><div>${S.aktywny
    ? '<button class="glowny" data-a="wroc">Wróć do treningu</button>'
    : `<button class="glowny" data-a="start">Start: ${esc(wyb.nazwa.replace(' + brzuch', ''))}</button>`}</div></div>`;
}

function ekranTrening() {
  const t = S.aktywny;
  const d = dzien(t.dzienId);
  const cw = listaCwiczen(t, PLAN);
  const gotowe = cw.filter((c) => zrobione(t, c.id).length >= parsujCel(c.cel).serie).length;
  const rozgZrob = d.rozgrzewka.filter((_, i) => t.rozgrzewka?.includes(i)).length;
  const zaczete = cw.some((c) => zrobione(t, c.id).length);

  const rozg = `<details class="rozgrzewka" ${rozgZrob < d.rozgrzewka.length && !zaczete ? 'open' : ''}>
    <summary><span class="ikona-rozg">🔥</span><b>Rozgrzewka</b><span>${rozgZrob}/${d.rozgrzewka.length}</span></summary>
    ${d.rozgrzewka.map((r, i) => `<button class="punkt ${t.rozgrzewka?.includes(i) ? 'z' : ''}" data-a="rozg" data-i="${i}">
      <span class="ptaszek">✓</span><span class="n"><b>${esc(r.nazwa)}</b><span>${esc(r.ile)}${r.rada ? ' · ' + esc(r.rada) : ''}</span></span></button>`).join('')}
  </details>`;

  const karty = cw.map((c) => {
    const cel = parsujCel(c.cel);
    const z = zrobione(t, c.id);
    const n = z.length;
    const stan = n >= cel.serie ? 'gotowe' : n > 0 ? 'trwa' : '';
    return `<button class="karta-cw ${stan}" data-a="cw" data-id="${esc(c.id)}">${obrazek(c)}
      <span class="n"><b>${esc(c.nazwa)}</b>${n ? `<span>${esc(serieTekst(z, cel.jednostka))}</span>` : linijkaPropozycji(t.dataPlanu, c)}
      <span class="kropki">${Array.from({ length: Math.max(cel.serie, n) }, (_, i) => `<i class="${i < n ? 'z' : ''}"></i>`).join('')}</span></span>
      <span class="licz">${n >= cel.serie ? '✓' : `${n}/${cel.serie}`}</span></button>`;
  }).join('');

  return `
  <div class="pasek"><button class="wstecz" data-a="dom">Start</button><h1>${esc(d.nazwa)}</h1><span class="zegar" id="zegar-treningu"></span></div>
  <div class="postep"><i style="width:${cw.length ? (gotowe / cw.length) * 100 : 0}%"></i></div>
  ${rozg}
  <div class="sekcja"><h3>Ćwiczenia · ${gotowe}/${cw.length}</h3><span class="podpowiedz">w dowolnej kolejności</span></div>
  ${karty}
  <button class="dodaj-cw" data-a="dodaj">+ Ćwiczenie spoza planu</button>
  ${d.naKoniec ? `<div class="sekcja"><h3>Na koniec</h3></div><div class="rada">${esc(d.naKoniec)}</div>` : ''}
  <div class="dolny"><div><button class="drugi pelny" data-a="zakoncz">Zakończ trening</button></div></div>`;
}

// ----- Ekran ćwiczenia: wiersze serii, aktywna seria ma suwaki kg i powtórzeń -----
function kontekstCw() {
  const t = S.aktywny;
  const lista = listaCwiczen(t, PLAN);
  const idx = lista.findIndex((c) => c.id === V.cwId);
  const c = lista[idx];
  const cel = parsujCel(c.cel);
  const w = wpisCw(t, c);
  const akt = V.akt != null && w.serie[V.akt] ? V.akt : aktywnaSeria(w.serie);
  return { t, lista, idx, c, cel, w, akt, krok: c.krok || S.ustawienia.krokKg };
}

function htmlPropozycji(k) {
  const p = propozycjaCw(k.t.dataPlanu, k.c);
  if (!p) return '';
  const wstawione = k.w.serie.filter((s) => !s.z).every((s) => Number(s.kg) === p.kg && Number(s.powt) === p.powt);
  return `<button class="propozycja ${p.start ? 'start' : ''} ${wstawione ? 'wstawiona' : ''}" data-a="wstaw">
    <span class="pr-tekst"><small>${p.start ? 'Propozycja startowa' : 'Propozycja na dziś'}</small><b>${esc(propozycjaKrotko(p, k.cel))}</b><span>${esc(p.powod)}${p.start && k.c.startUwaga ? ' (' + esc(k.c.startUwaga) + ')' : ''}</span></span>
    <span class="pr-przycisk">${wstawione ? '✓ Jest' : 'Wstaw'}</span></button>`;
}

const kgNaSuwaku = (v) => (Number(v) ? formatKg(v) : 'bez');

function suwak(pole, i, wartosci, obecna, krok, fmt, etykieta) {
  const v0 = Number(obecna);
  return `<div class="suwak">
    <div class="s-gora"><span>${esc(etykieta)}</span><button class="s-wpisz" data-a="wpisz" data-p="${pole}" data-i="${i}">wpisz ręcznie</button></div>
    <div class="s-rzad">
      <button class="s-kr" data-a="krok" data-p="${pole}" data-i="${i}" data-o="${-krok}" aria-label="mniej o ${esc(formatKg(krok))}">−</button>
      <div class="lin-ramka"><div class="linijka" data-p="${pole}" data-i="${i}" role="listbox" aria-label="${esc(etykieta)}"><div class="tor">${wartosci.map((v) => `<button data-a="wybierz" data-v="${v}" class="${v === v0 ? 'on' : ''}" role="option" aria-selected="${v === v0}">${esc(fmt(v))}</button>`).join('')}</div></div></div>
      <button class="s-kr" data-a="krok" data-p="${pole}" data-i="${i}" data-o="${krok}" aria-label="więcej o ${esc(formatKg(krok))}">+</button>
    </div></div>`;
}

function htmlSerii(k) {
  const { c, cel, w, akt, krok } = k;
  const sek = cel.jednostka === 's';
  const jedn = sek ? 's' : 'powt.';
  const prop = propozycjaCw(k.t.dataPlanu, c);
  const wiersze = w.serie.map((s, i) => {
    const on = i === akt;
    const panel = on ? `<div class="panel">
      ${suwak('kg', i, wartosciKg({ kg: s.kg, prop: prop?.kg, krok }), s.kg, krok, kgNaSuwaku, `Ciężar, kg${c.hantle ? ' na hantel' : ''}`)}
      ${suwak('powt', i, wartosciPowt(cel, s.powt), s.powt, sek ? 5 : 1, String, sek ? 'Czas, sekundy' : 'Powtórzenia')}
    </div>` : '';
    return `<div class="wiersz ${s.z ? 'z' : ''} ${on ? 'akt' : ''}" data-i="${i}">
      <button class="w-gl" data-a="aktywna" data-i="${i}" aria-label="Seria ${i + 1}: zmień">
        <span class="nr">${i + 1}</span>
        <span class="w-war"><b class="w-kg">${esc(kgNaSuwaku(s.kg))}</b><small class="w-kg-j">${Number(s.kg) ? 'kg' : ''}</small></span>
        <span class="w-x">×</span>
        <span class="w-war"><b class="w-powt">${esc(s.powt)}</b><small>${jedn}</small></span>
        ${on ? '' : '<span class="w-zmien">zmień</span>'}
      </button>
      <button class="ptak" data-a="odhacz" data-i="${i}" aria-label="${s.z ? 'Odznacz' : 'Odhacz'} serię ${i + 1}" aria-pressed="${s.z}">✓</button>
      ${panel}
    </div>`;
  }).join('');
  return `${wiersze}
    <div class="rzad-serii"><button class="dodaj-serie" data-a="dodaj-serie">+ Seria</button>${w.serie.length > 1 ? `<button class="dodaj-serie" data-a="usun-serie" data-i="${w.serie.length - 1}">− Seria</button>` : ''}</div>`;
}

function htmlDolu(k) {
  const { t, lista, idx, w, akt, cel } = k;
  const nastepne = lista.slice(idx + 1).concat(lista.slice(0, idx)).find((x) => zrobione(t, x.id).length < parsujCel(x.cel).serie);
  const nr = akt >= 0 && !w.serie[akt].z ? akt : aktywnaSeria(w.serie);
  if (nr >= 0) {
    const s = w.serie[nr];
    return `<div><button class="glowny dalej" data-a="odhacz" data-i="${nr}" id="glowny-seria">✓ Zrobiona seria ${nr + 1}${nr + 1 > cel.serie ? '' : ` z ${cel.serie}`}<small id="glowny-opis">${esc(opisSerii(s, cel))}</small></button></div>`;
  }
  return `<div>${nastepne
    ? `<button class="drugi" data-a="lista">Lista</button><button class="glowny dalej" data-a="cw" data-id="${esc(nastepne.id)}">Dalej ›<small>${esc(skrot(nastepne.nazwa))}</small></button>`
    : '<button class="glowny" data-a="lista">Gotowe ✓</button>'}</div>`;
}
function opisSerii(s, cel) {
  const ile = cel.jednostka === 's' ? `${s.powt} s` : `${s.powt} powt.`;
  return Number(s.kg) ? `${formatKg(s.kg)} kg × ${ile}` : ile;
}

function ekranCwiczenie() {
  const k = kontekstCw();
  const { c, lista, idx, w, t } = k;
  const o = ostatnioCw(c);
  const mala = S.ustawienia.malyObraz;
  const strzalki = `<button class="nav-cw lewo" data-a="poprz" ${idx === 0 ? 'disabled' : ''} aria-label="Poprzednie ćwiczenie">‹</button><button class="nav-cw prawo" data-a="nast" ${idx === lista.length - 1 ? 'disabled' : ''} aria-label="Następne ćwiczenie">›</button>`;
  const zdj = c.zdjecia?.length
    ? `<div class="anim ${mala ? 'mala' : ''}" data-a="obraz" aria-label="${mala ? 'Powiększ' : 'Zmniejsz'} ilustrację">${c.zdjecia.slice(0, 2).map((z) => `<img src="${esc(z)}" alt="">`).join('')}${strzalki}${c.yt ? `<a class="yt" href="${esc(c.yt)}" target="_blank" rel="noopener">▶ Technika</a>` : ''}</div>`
    : `<div class="bez-obrazu">${strzalki}</div>`;
  const kropki = `<div class="kropki-cw" aria-hidden="true">${lista.map((x, i) => `<i class="${i === idx ? 'teraz' : ''} ${zrobione(t, x.id).length >= parsujCel(x.cel).serie ? 'z' : ''}"></i>`).join('')}</div>`;
  const oceny = `<div class="podpis">Jak szło to ćwiczenie?</div><div class="oceny">${Object.entries(OCENY).map(([key, n]) => `<button class="${key} ${w.ocena === key ? 'on' : ''}" data-a="ocena" data-k="${key}">${key === 'ok' ? 'OK' : n[0].toUpperCase() + n.slice(1)}</button>`).join('')}</div>`;

  return `<div class="przesuwne">
  <div class="pasek"><button class="wstecz" data-a="lista">Lista</button><h1>${idx + 1} z ${lista.length}</h1><span class="zegar" id="zegar-treningu"></span></div>
  ${kropki}
  ${zdj}
  <h2 class="tytul-cw">${esc(c.nazwa)}</h2>
  <div class="cel-cw"><span><b>${esc(c.cel)}</b>${c.przerwa ? ` · przerwa ${esc(c.przerwa)}` : ''}</span>${c.rada ? `<button class="technika-btn" data-a="technika" aria-expanded="${!!V.technika}">Technika ${V.technika ? '▴' : '▾'}</button>` : ''}</div>
  ${c.rada ? `<div class="rada" id="technika" ${V.technika ? '' : 'hidden'}><p>${esc(c.rada)}</p>${c.uwaga ? `<p style="color:var(--szary)">${esc(c.uwaga)}</p>` : ''}${c.yt ? `<p><a href="${esc(c.yt)}" target="_blank" rel="noopener">▶ Filmy z techniką (YouTube)</a></p>` : ''}</div>` : ''}
  ${o ? `<p class="ostatnio">Ostatnio (${esc(dataKrotka(o.data))}${o.znane ? ', zapis Trenera' : ''}): <b>${esc(serieTekst(o.serie, k.cel.jednostka))}</b>${o.ocena ? ' · ' + OCENY[o.ocena] : ''}</p>` : ''}
  <div id="propozycja">${htmlPropozycji(k)}</div>
  <div class="serie" id="serie">${htmlSerii(k)}</div>
  ${oceny}
  </div>
  <div class="dolny" id="dol">${htmlDolu(k)}</div>`;
}

/** Suwaki: obecna wartość na środku (bez animacji po przerysowaniu, płynnie po +/−). */
function ustawLinijki(plynnie = false) {
  document.querySelectorAll('.linijka').forEach((l) => {
    const on = l.querySelector('.on');
    if (!on || !l.clientWidth) return;
    const cel = on.offsetLeft + on.offsetWidth / 2 - l.clientWidth / 2;
    l._dotyk = false;
    l.scrollTo({ left: cel, behavior: plynnie ? 'smooth' : 'auto' });
  });
}

/** Odświeża tylko serie, propozycję i dolny przycisk (bez przewijania i bez przerysowania reszty). */
function odswiezCwiczenie() {
  if (V.ekran !== 'cwiczenie') return;
  const k = kontekstCw();
  $('#propozycja').innerHTML = htmlPropozycji(k);
  $('#serie').innerHTML = htmlSerii(k);
  $('#dol').innerHTML = htmlDolu(k);
  ustawLinijki();
}
/** Po zmianie liczby: etykiety wiersza i dolnego przycisku, stan propozycji. */
function odswiezEtykiety(i) {
  const k = kontekstCw();
  const s = k.w.serie[i];
  const r = $(`.wiersz[data-i="${i}"]`);
  if (s && r) {
    $('.w-kg', r).textContent = kgNaSuwaku(s.kg);
    $('.w-kg-j', r).textContent = Number(s.kg) ? 'kg' : '';
    $('.w-powt', r).textContent = String(s.powt);
  }
  const opis = $('#glowny-opis');
  const nr = Number($('#glowny-seria')?.dataset.i);
  if (opis && k.w.serie[nr]) opis.textContent = opisSerii(k.w.serie[nr], k.cel);
  $('#propozycja').innerHTML = htmlPropozycji(k);
}
/** Aktywna seria zasłonięta przez pasek przerwy albo dolny przycisk: przewiń łagodnie tylko tyle, żeby było widać. */
function pokazAktywny() {
  const r = $('.wiersz.akt') || $('.wiersz:not(.z)');
  if (!r) return;
  const zaslony = [$('#przerwa'), $('#dol')].filter((e) => e && !e.hidden).map((e) => e.getBoundingClientRect().top);
  const granica = Math.min(window.innerHeight, ...zaslony) - 8;
  const { top, bottom } = r.getBoundingClientRect();
  if (bottom > granica) window.scrollBy({ top: Math.min(bottom - granica, top - 8), behavior: 'smooth' });
  else if (top < 0) window.scrollBy({ top: top - 12, behavior: 'smooth' });
}

/** Przesunięcie palcem w bok: następne/poprzednie ćwiczenie albo dzień planu. */
function przesun(kier) {
  if (V.ekran === 'cwiczenie') {
    const lista = listaCwiczen(S.aktywny, PLAN);
    const i = lista.findIndex((c) => c.id === V.cwId) + kier;
    if (i < 0 || i >= lista.length) return false;
    idz('cwiczenie', { cwId: lista[i].id });
  } else if (V.ekran === 'start') {
    const i = PLAN.findIndex((d) => d.id === V.dzienId) + kier;
    if (i < 0 || i >= PLAN.length) return false;
    V.dzienId = PLAN[i].id;
    render();
  } else return false;
  const el = $('.przesuwne');
  if (el) { el.classList.add(kier > 0 ? 'wjazd-p' : 'wjazd-l'); setTimeout(() => el.classList.remove('wjazd-p', 'wjazd-l'), 320); }
  wibruj(6);
  return true;
}

function skrot(n) { return n.length > 28 ? n.slice(0, 26).trimEnd() + '…' : n; }
function dataKrotka(iso) { const [, m, d] = iso.split('-'); return `${Number(d)}.${m}`; }

function ekranKoniec() {
  const t = S.historia.find((h) => h.id === V.koniecId);
  if (!t) return ekranStart();
  const przed = S.historia.filter((h) => h.id !== t.id && h.start < t.start);
  const st = statystyki(t, PLAN);
  const rek = rekordy(t, przed, PLAN);
  return `
  <div class="srodek"><div class="duzy-ptak">✓</div><h2 style="margin:0 0 4px">Trening zapisany</h2><p style="color:var(--szary);margin:0 0 20px">${esc(dzien(t.dzienId)?.nazwa || '')}</p></div>
  <div class="kafle">
    <div class="kafel"><b>${esc(formatCzasTrwania(t.koniec - t.start))}</b><span>czas</span></div>
    <div class="kafel"><b>${st.serie}</b><span>serii</span></div>
    <div class="kafel"><b>${st.objetosc >= 1000 ? formatKg(Math.round(st.objetosc / 100) / 10) + ' t' : st.objetosc + ' kg'}</b><span>podniesione</span></div>
  </div>
  ${rek.map((r) => `<div class="rekord">🏆 ${esc(r.nazwa)}: ${formatKg(r.kg)} kg (było ${formatKg(r.bylo)})</div>`).join('')}
  <div class="sekcja"><h3>Notatka dla Trenera (opcjonalnie)</h3></div>
  <textarea id="notatka" placeholder="np. bolał bark, siłownia pełna, zmieniłem kolejność">${esc(t.notatka || '')}</textarea>
  <div class="sekcja"><h3>Do wklejenia Trenerowi</h3></div>
  <pre class="tekst-podsumowania" id="tekst">${esc(podsumowanie(t, PLAN))}</pre>
  <div class="dolny"><div><button class="drugi" data-a="dom">Gotowe</button><button class="glowny" data-a="kopiuj" data-id="${esc(t.id)}">Kopiuj podsumowanie</button></div></div>`;
}

function ekranHistoria() {
  const wpisy = [...S.historia].reverse().map((t) => {
    const st = statystyki(t, PLAN);
    return `<details class="wpis-hist"><summary><span class="n"><b>${esc(dzien(t.dzienId)?.nazwa || t.nazwa || '')}</b>
      <span>${esc(new Date(t.dataPlanu + 'T12:00').toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' }))} · ${esc(formatCzasTrwania(t.koniec - t.start))} · ${st.serie} serii</span></span><span style="color:var(--szary)">›</span></summary>
      <div class="tresc"><pre class="tekst-podsumowania">${esc(podsumowanie(t, PLAN))}</pre>
      <div class="rzad"><button class="drugi" data-a="kopiuj" data-id="${esc(t.id)}">Kopiuj</button><button class="drugi zle-tekst" data-a="usun-trening" data-id="${esc(t.id)}">Usuń</button></div></div></details>`;
  }).join('');
  return `
  <div class="pasek"><button class="wstecz" data-a="dom">Start</button><h1>Historia</h1><button class="prawy" data-a="ustawienia">Opcje</button></div>
  ${wpisy || '<p class="pusto">Jeszcze nic. Po pierwszym treningu pojawi się tutaj.</p>'}`;
}

function ekranUstawienia() {
  const u = S.ustawienia;
  const prz = (k, n) => `<label class="przelacznik"><span>${n}</span><input type="checkbox" data-u="${k}" ${u[k] ? 'checked' : ''}></label>`;
  return `
  <div class="pasek"><button class="wstecz" data-a="historia">Historia</button><h1>Opcje</h1><span style="min-width:64px"></span></div>
  <div class="ustawienia">
    ${prz('przerwaAuto', 'Przerwa rusza sama po odhaczeniu serii')}
    ${prz('dzwiek', 'Dźwięk na koniec przerwy')}
    ${prz('wibracje', 'Wibracja na koniec przerwy (Android)')}
    ${prz('ekran', 'Ekran nie gaśnie w trakcie treningu')}
    <label class="przelacznik"><span>Krok +/− dla ćwiczeń spoza planu</span><select data-u="krokKg">${[1, 1.25, 2, 2.5, 5].map((k) => `<option value="${k}" ${u.krokKg === k ? 'selected' : ''}>${formatKg(k)} kg</option>`).join('')}</select></label>
  </div>
  <div class="sekcja"><h3>Kopia zapasowa</h3></div>
  <p style="color:var(--szary);font-size:14px;margin:0 0 10px">Historia jest tylko w tej przeglądarce na tym telefonie. Raz na jakiś czas zrób kopię.</p>
  <div class="rzad"><button class="drugi" data-a="eksport">Zapisz kopię</button><button class="drugi" data-a="import">Wczytaj kopię</button></div>
  <input type="file" id="plik" accept="application/json,.json" hidden>`;
}

// ---------- Okna dialogowe ----------
function pytanie({ tytul, tekst = '', tak = 'Tak', nie = 'Anuluj', pole = null, groznie = false, wartosc = '', klawiatura = 'text' }) {
  return new Promise((ok) => {
    const d = document.createElement('dialog');
    d.innerHTML = `<h3>${esc(tytul)}</h3>${tekst ? `<p>${esc(tekst)}</p>` : ''}
      ${pole ? `<input type="text" id="dl-pole" placeholder="${esc(pole)}" value="${esc(wartosc)}" inputmode="${esc(klawiatura)}" enterkeyhint="done" autocomplete="off">` : ''}
      <div class="rzad"><button class="drugi pelny" value="nie">${esc(nie)}</button><button class="${groznie ? 'drugi zle-tekst' : 'glowny'} pelny" value="tak">${esc(tak)}</button></div>`;
    document.body.append(d);
    d.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const wynik = b.value === 'tak' ? (pole ? $('#dl-pole', d).value.trim() || null : true) : b.value === 'nie' ? false : null;
      d.close();
      d.remove();
      ok(wynik);
    });
    d.addEventListener('cancel', () => { d.remove(); ok(null); });
    d.showModal();
    if (pole) {
      const el = $('#dl-pole', d);
      el.focus();
      el.select();
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('button[value="tak"]', d).click(); } });
    }
  });
}

// ---------- Akcje ----------
function liczba(t) { const n = parseFloat(String(t).replace(',', '.')); return Number.isFinite(n) ? n : 0; }
const zaokr = (x) => Math.max(0, Math.round(x * 100) / 100);

function startTreningu(dzienId) {
  const { data, dzis } = dzienPlanu(new Date(), PLAN);
  // Dzień wolny, a robisz trening z planu: zapisujemy go pod dzisiejszą datą (dnia planu).
  S.aktywny = { id: 't' + teraz().toString(36), dzienId, nazwa: dzien(dzienId).nazwa, dataPlanu: data, start: teraz(), cwiczenia: {}, rozgrzewka: [], dodatkowe: [], przerwa: null, planowy: dzis?.id === dzienId };
  zapisz();
  odblokujDzwiek();
  idz('trening');
}

async function zakonczTrening() {
  const t = S.aktywny;
  const lista = listaCwiczen(t, PLAN);
  const wpisaneNieodhaczone = Object.values(t.cwiczenia).flatMap((c) => c.serie.filter((s) => !s.z && !s.auto));
  if (wpisaneNieodhaczone.length) {
    const n = wpisaneNieodhaczone.length;
    const w = await pytanie({ tytul: `${n} ${n === 1 ? 'seria wpisana, ale nieodhaczona' : 'serie wpisane, ale nieodhaczone'}`, tekst: 'Zaliczyć je jako zrobione?', tak: 'Zalicz', nie: 'Pomiń je' });
    if (w === null) return;
    if (w) for (const s of wpisaneNieodhaczone) { s.z = true; s.t = s.t || teraz(); }
    zapisz();
  }
  const gotowyT = tylkoZrobione(t);
  const bez = lista.filter((c) => !gotowyT.cwiczenia[c.id]).length;
  const st = statystyki(gotowyT, PLAN);
  if (!st.serie) {
    const w = await pytanie({ tytul: 'Nie ma żadnej odhaczonej serii', tekst: 'Odrzucić ten trening?', tak: 'Odrzuć', nie: 'Wróć', groznie: true });
    if (w) { S.aktywny = null; zapisz(); idz('start'); }
    return;
  }
  const w = await pytanie({ tytul: 'Zakończyć trening?', tekst: bez ? `${bez} ${bez === 1 ? 'ćwiczenie jest' : 'ćwiczeń jest'} bez żadnej serii, trafią na listę pominiętych.` : 'Wszystko zrobione. Dobra robota.', tak: 'Zakończ', nie: 'Jeszcze nie' });
  if (!w) return;
  const { przerwa, ...reszta } = gotowyT;
  const gotowy = { ...reszta, koniec: teraz() };
  S.historia.push(gotowy);
  $('#toast').hidden = true;
  S.aktywny = null;
  zapisz();
  pusc();
  idz('koniec', { koniecId: gotowy.id });
}

/** Kopiowanie na telefonie: schowek, potem execCommand, a na końcu zaznaczenie tekstu na ekranie. */
async function kopiuj(tekst, pre) {
  const ok = () => toast('Skopiowane. Wklej na kanale #trener.');
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(tekst); ok(); return; } catch { /* dalej */ }
  }
  const a = document.createElement('textarea');
  a.value = tekst;
  a.setAttribute('readonly', '');
  a.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
  document.body.append(a);
  a.focus({ preventScroll: true });
  a.select();
  a.setSelectionRange(0, tekst.length);
  let udane = false;
  try { udane = document.execCommand('copy'); } catch { udane = false; }
  a.remove();
  if (udane) { ok(); return; }
  if (pre) {
    const r = document.createRange();
    r.selectNodeContents(pre);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    pre.scrollIntoView({ block: 'center' });
  }
  toast('Nie mogę sam skopiować: tekst jest zaznaczony, przytrzymaj go i wybierz Kopiuj.');
}

function zmienPole(i, pole, wartosc) {
  const k = kontekstCw();
  const s = k.w.serie[i];
  if (!s || Number(s[pole]) === Number(wartosc)) return;
  s[pole] = wartosc;
  s.auto = false;
  zapisz();
  odswiezEtykiety(i);
}

/** Zaznacza wartość na suwaku i przesuwa ją na środek. false = takiej wartości nie ma na suwaku. */
function zaznaczNaLinijce(l, v, plynnie = true) {
  const b = [...l.querySelectorAll('[data-v]')].find((x) => Number(x.dataset.v) === Number(v));
  if (!b) return false;
  l.querySelectorAll('.on').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-selected', 'false'); });
  b.classList.add('on');
  b.setAttribute('aria-selected', 'true');
  l._dotyk = false;
  l.scrollTo({ left: b.offsetLeft + b.offsetWidth / 2 - l.clientWidth / 2, behavior: plynnie ? 'smooth' : 'auto' });
  return true;
}
const linijka = (pole, i) => $(`.linijka[data-p="${pole}"][data-i="${i}"]`);

document.addEventListener('click', async (e) => {
  if (e.target.closest('a[href]')) return;
  const b = e.target.closest('[data-a]');
  if (!b || b.disabled) return;
  const a = b.dataset.a;
  const t = S.aktywny;
  odblokujDzwiek();

  switch (a) {
    case 'dzien': V.dzienId = b.dataset.id; render(); break;
    case 'start': startTreningu(V.dzienId); break;
    case 'wroc': case 'lista': idz('trening'); break;
    case 'dom': idz('start'); break;
    case 'historia': idz('historia'); break;
    case 'ustawienia': idz('ustawienia'); break;
    case 'cw': idz('cwiczenie', { cwId: b.dataset.id }); break;
    case 'obraz': {
      S.ustawienia.malyObraz = !S.ustawienia.malyObraz;
      zapisz();
      b.classList.toggle('mala', S.ustawienia.malyObraz);
      break;
    }
    case 'technika': {
      V.technika = !V.technika;
      $('#technika').hidden = !V.technika;
      b.setAttribute('aria-expanded', String(V.technika));
      b.textContent = `Technika ${V.technika ? '▴' : '▾'}`;
      break;
    }
    case 'poprz': przesun(-1); break;
    case 'nast': przesun(1); break;
    case 'aktywna': {
      const i = Number(b.dataset.i);
      if (kontekstCw().akt === i) break;
      V.akt = i;
      odswiezCwiczenie();
      pokazAktywny();
      break;
    }
    case 'wybierz': {
      const l = b.closest('.linijka');
      const v = Number(b.dataset.v);
      zmienPole(Number(l.dataset.i), l.dataset.p, v);
      zaznaczNaLinijce(l, v);
      wibruj(5);
      break;
    }
    case 'wpisz': {
      const i = Number(b.dataset.i);
      const p = b.dataset.p;
      const k = kontekstCw();
      const s = k.w.serie[i];
      const kg = p === 'kg';
      const w = await pytanie({
        tytul: `Seria ${i + 1}: ${kg ? 'ciężar' : k.cel.jednostka === 's' ? 'czas' : 'powtórzenia'}`,
        tekst: kg ? 'W kilogramach, np. 52,5' : k.cel.jednostka === 's' ? 'W sekundach' : '',
        pole: kg ? 'kg' : 'liczba', wartosc: kg ? formatKg(s.kg) : String(s.powt), klawiatura: kg ? 'decimal' : 'numeric', tak: 'Gotowe',
      });
      if (w == null || w === false) break;
      const v = kg ? zaokr(liczba(w)) : Math.max(0, Math.round(liczba(w)));
      zmienPole(i, p, v);
      odswiezCwiczenie();
      break;
    }
    case 'rozg': {
      const i = Number(b.dataset.i);
      t.rozgrzewka = t.rozgrzewka.includes(i) ? t.rozgrzewka.filter((x) => x !== i) : [...t.rozgrzewka, i];
      zapisz();
      b.classList.toggle('z');
      const d = dzien(t.dzienId);
      b.closest('details').querySelector('summary span:last-child').textContent = `${t.rozgrzewka.length}/${d.rozgrzewka.length}`;
      break;
    }
    case 'krok': {
      const i = Number(b.dataset.i);
      const p = b.dataset.p;
      const k = kontekstCw();
      const s = k.w.serie[i];
      const nowa = p === 'kg' ? zaokr((Number(s.kg) || 0) + Number(b.dataset.o)) : Math.max(0, Math.round((Number(s.powt) || 0) + Number(b.dataset.o)));
      zmienPole(i, p, nowa);
      const l = linijka(p, i);
      if (!l || !zaznaczNaLinijce(l, nowa)) odswiezCwiczenie();
      wibruj(8);
      break;
    }
    case 'odhacz': {
      const k = kontekstCw();
      const i = Number(b.dataset.i);
      const s = k.w.serie[i];
      if (s.z) {
        s.z = false;
        V.akt = i;
        zapisz();
        odswiezCwiczenie();
        break;
      }
      odhaczSerie(k.w.serie, i, teraz());
      V.akt = null;
      if (S.ustawienia.przerwaAuto) startPrzerwy(przerwaSekundy(k.c.przerwa), k.c.id);
      zapisz();
      odswiezCwiczenie();
      tyk();
      pokazAktywny();
      wibruj(15);
      toast(`Seria ${i + 1}: ${opisSerii(s, k.cel)}`, () => {
        s.z = false;
        if (S.aktywny.przerwa?.cwId === k.c.id) S.aktywny.przerwa = null;
        zapisz();
        if (V.ekran === 'cwiczenie' && V.cwId === k.c.id) odswiezCwiczenie(); else render();
        tyk();
      });
      break;
    }
    case 'dodaj-serie': {
      const k = kontekstCw();
      const ost = k.w.serie[k.w.serie.length - 1];
      k.w.serie.push({ kg: ost ? ost.kg : 0, powt: ost ? ost.powt : k.cel.min, z: false, auto: true });
      V.akt = k.w.serie.length - 1;
      zapisz();
      odswiezCwiczenie();
      break;
    }
    case 'usun-serie': {
      const k = kontekstCw();
      const i = Number(b.dataset.i);
      const [s] = k.w.serie.splice(i, 1);
      V.akt = null;
      zapisz();
      odswiezCwiczenie();
      toast(`Usunięta seria ${i + 1}`, () => { k.w.serie.splice(i, 0, s); zapisz(); odswiezCwiczenie(); });
      break;
    }
    case 'wstaw': {
      const k = kontekstCw();
      const p = propozycjaCw(k.t.dataPlanu, k.c);
      if (!p) break;
      for (const s of k.w.serie) if (!s.z) { s.kg = p.kg; s.powt = p.powt; s.auto = true; }
      zapisz();
      odswiezCwiczenie();
      wibruj(8);
      break;
    }
    case 'ocena': {
      const w = wpisCw(t, cwiczenieTreningu(t, V.cwId));
      w.ocena = w.ocena === b.dataset.k ? '' : b.dataset.k;
      zapisz();
      document.querySelectorAll('.oceny button').forEach((x) => x.classList.toggle('on', x.dataset.k === w.ocena));
      break;
    }
    case 'przerwa': zmienPrzerwe(Number(b.dataset.o)); break;
    case 'pomin': koniecPrzerwy(); break;
    case 'dodaj': {
      const nazwa = await pytanie({ tytul: 'Ćwiczenie spoza planu', tekst: 'Np. zamiennik, gdy maszyna jest zajęta.', pole: 'Nazwa ćwiczenia', tak: 'Dodaj' });
      if (!nazwa) break;
      const id = 'x-' + teraz().toString(36);
      t.dodatkowe.push({ id, nazwa, cel: '3 x 8-12', przerwa: '90 s', rada: '', zdjecia: [], yt: '' });
      zapisz();
      idz('cwiczenie', { cwId: id });
      break;
    }
    case 'zakoncz': zakonczTrening(); break;
    case 'kopiuj': {
      const tr = S.historia.find((h) => h.id === b.dataset.id);
      const pre = b.closest('.tresc')?.querySelector('pre') || $('#tekst');
      if (tr) kopiuj(podsumowanie(tr, PLAN), pre);
      break;
    }
    case 'usun-trening': {
      if (!(await pytanie({ tytul: 'Usunąć ten trening z historii?', tak: 'Usuń', groznie: true }))) break;
      S.historia = S.historia.filter((h) => h.id !== b.dataset.id);
      zapisz();
      render();
      break;
    }
    case 'eksport': {
      const blob = new Blob([JSON.stringify({ wersja: 2, zapisano: new Date().toISOString(), ...S }, null, 1)], { type: 'application/json' });
      const l = document.createElement('a');
      l.href = URL.createObjectURL(blob);
      l.download = `trening-kopia-${new Date().toISOString().slice(0, 10)}.json`;
      l.click();
      setTimeout(() => URL.revokeObjectURL(l.href), 2000);
      break;
    }
    case 'import': $('#plik').click(); break;
    case 'cofnij': {
      const el = $('#toast');
      const f = el._cofnij;
      el.hidden = true;
      el._cofnij = null;
      if (f) f();
      break;
    }
    default: break;
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'notatka') {
    const tr = S.historia.find((h) => h.id === V.koniecId);
    if (tr) { tr.notatka = el.value.trim(); zapisz(); $('#tekst').textContent = podsumowanie(tr, PLAN); }
  }
});

// ----- Suwaki: przesuwanie palcem zmienia wartość (ta na środku), dopiero po dotknięciu suwaka -----
for (const ev of ['pointerdown', 'touchstart', 'wheel']) {
  document.addEventListener(ev, (e) => { const l = e.target.closest?.('.linijka'); if (l) l._dotyk = true; }, { passive: true, capture: true });
}
document.addEventListener('scroll', (e) => {
  const l = e.target;
  if (!l.classList?.contains('linijka') || !l._dotyk) return;
  const srodek = l.scrollLeft + l.clientWidth / 2;
  let najb = null;
  let odl = Infinity;
  for (const x of l.firstElementChild.children) {
    const d = Math.abs(x.offsetLeft + x.offsetWidth / 2 - srodek);
    if (d < odl) { odl = d; najb = x; }
  }
  if (!najb || najb.classList.contains('on')) return;
  l.querySelectorAll('.on').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-selected', 'false'); });
  najb.classList.add('on');
  najb.setAttribute('aria-selected', 'true');
  zmienPole(Number(l.dataset.i), l.dataset.p, Number(najb.dataset.v));
  wibruj(3);
}, true);

// ----- Przesunięcie palcem w bok: inne ćwiczenie (ekran ćwiczenia) albo inny dzień (start) -----
const BEZ_PRZESUWANIA = '.linijka, .suwak, input, textarea, dialog, .przerwa, .dolny, .toast';
let palec = null;
document.addEventListener('touchstart', (e) => {
  palec = null;
  if (e.touches.length !== 1 || !['cwiczenie', 'start'].includes(V.ekran) || e.target.closest(BEZ_PRZESUWANIA)) return;
  const el = $('.przesuwne');
  if (!el) return;
  palec = { x: e.touches[0].clientX, y: e.touches[0].clientY, kier: null, dx: 0, el };
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!palec) return;
  const dx = e.touches[0].clientX - palec.x;
  const dy = e.touches[0].clientY - palec.y;
  if (!palec.kier) {
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
    palec.kier = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y';
  }
  if (palec.kier !== 'x') return;
  palec.dx = dx;
  palec.el.style.transition = 'none';
  palec.el.style.transform = `translateX(${dx * 0.5}px)`;
  palec.el.style.opacity = String(Math.max(0.5, 1 - Math.abs(dx) / 600));
}, { passive: true });
function puscPalec() {
  if (!palec) return;
  const { kier, dx, el } = palec;
  palec = null;
  if (kier !== 'x') return;
  el.style.transform = '';
  el.style.opacity = '';
  el.style.transition = '';
  if (Math.abs(dx) > 70) przesun(dx < 0 ? 1 : -1);
}
document.addEventListener('touchend', puscPalec, { passive: true });
document.addEventListener('touchcancel', puscPalec, { passive: true });

document.addEventListener('change', async (e) => {
  const u = e.target.dataset?.u;
  if (u) {
    S.ustawienia[u] = e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value);
    zapisz();
    if (u === 'ekran' && !e.target.checked) pusc();
    return;
  }
  if (e.target.id === 'plik' && e.target.files[0]) {
    try {
      const d = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(d.historia)) throw new Error('to nie jest kopia apki');
      const ile = d.historia.length;
      if (!(await pytanie({ tytul: 'Wczytać kopię?', tekst: `${ile} treningów. Treningi, których tu nie ma, zostaną dodane, nic nie zniknie.`, tak: 'Wczytaj' }))) return;
      const mam = new Set(S.historia.map((h) => h.id));
      S.historia = [...S.historia, ...d.historia.filter((h) => !mam.has(h.id))].sort((x, y) => x.start - y.start);
      zapisz();
      toast(`Wczytane: ${ile} treningów`);
    } catch (err) {
      toast('Nie da się wczytać: ' + err.message);
    }
    e.target.value = '';
  }
});

// Powrót przyciskiem "wstecz" telefonu: zamiast wyjścia z apki, cofnięcie ekranu.
history.replaceState({ apka: 1 }, '');
if (V.ekran !== 'start') history.pushState({ apka: 2 }, '');
window.addEventListener('popstate', () => {
  const wstecz = { cwiczenie: 'trening', trening: 'start', historia: 'start', ustawienia: 'historia', koniec: 'start' };
  if (V.ekran === 'start') return;
  idz(wstecz[V.ekran] || 'start');
});

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

render();
