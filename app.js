import { PLAN, START_TRENINGU } from './plan.js';
import {
  parsujCel, przerwaSekundy, dzienPlanu, formatKg, formatCzas, formatCzasTrwania, seriaTekst, serieTekst,
  ostatnio, dataISO, propozycja, wierszeStartowe, odhaczSerie, aktywnaSeria, tydzienPlanu,
  podsumowanie, statystyki, rekordy, listaCwiczen, OCENY,
} from './logika.js';

// ---------- Stan i zapis ----------
const KLUCZ = 'trening.v2';
const DOMYSLNE = { aktywny: null, historia: [], ustawienia: { dzwiek: true, wibracje: true, ekran: true, przerwaAuto: true, krokKg: 2.5 } };

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
let V = { ekran: S.aktywny ? 'trening' : 'start', dzienId: null, cwId: null, koniecId: null, akt: null, zdjecie: false };

const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dzien = (id) => PLAN.find((d) => d.id === id);
const teraz = () => Date.now();

function cwiczenieTreningu(t, cwId) {
  return listaCwiczen(t, PLAN).find((c) => c.id === cwId);
}
const zrobione = (t, cwId) => (t.cwiczenia[cwId]?.serie || []).filter((s) => s.z);
const ostatnioCw = (c) => ostatnio(S.historia, c.id, c.znane);

function propozycjaCw(t, c) {
  const startKg = stareKg[c.nazwa]?.kg ? Number(stareKg[c.nazwa].kg) : c.startKg;
  return propozycja({ ost: ostatnioCw(c), cel: parsujCel(c.cel), startKg, krok: c.krok || S.ustawienia.krokKg, tydzien: tydzienPlanu(t.dataPlanu, START_TRENINGU) });
}

/** Wpis ćwiczenia w treningu; przy pierwszym otwarciu wiersze serii z ostatniego razu. */
function wpisCw(t, c) {
  if (!t.cwiczenia[c.id]) {
    t.cwiczenia[c.id] = { serie: wierszeStartowe({ cel: parsujCel(c.cel), ost: ostatnioCw(c), prop: propozycjaCw(t, c) }), ocena: '' };
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
  ukladPrzerwy = '';
  tyk();
  if (S.aktywny) trzymajEkran(); else pusc();
}

function idz(ekran, zmiany = {}) {
  V = { ...V, ekran, akt: null, ...zmiany };
  if (ekran === 'cwiczenie' && !('zdjecie' in zmiany)) {
    // Duże zdjęcie tylko przy ćwiczeniu, którego jeszcze nie robiłeś (decyzja raz, na wejściu, żeby ekran nie skakał).
    const c = cwiczenieTreningu(S.aktywny, V.cwId);
    V.zdjecie = !!c && !ostatnioCw(c) && !zrobione(S.aktywny, V.cwId).length;
  }
  if (ekran !== 'start' && history.state?.apka !== 2) history.pushState({ apka: 2 }, '');
  render();
  window.scrollTo(0, 0);
}

function miniatura(c) {
  return c.zdjecia && c.zdjecia[0]
    ? `<img class="miniatura" src="${esc(c.zdjecia[0])}" alt="" loading="lazy">`
    : '<span class="miniatura puste">＋</span>';
}

function ostatnioKrotko(cw) {
  const o = ostatnioCw(cw);
  return o ? serieTekst(o.serie, parsujCel(cw.cel).jednostka) : '';
}

function zrobioneWTygodniu(dataPlanu) {
  return new Set(S.historia.filter((h) => h.dataPlanu >= dataPlanu).map((h) => h.dzienId));
}
function dataSlownie(iso) {
  const t = new Date(iso + 'T12:00').toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
  return t[0].toUpperCase() + t.slice(1);
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

  const naglowek = dzis
    ? `<small>${esc(dataTekst)}${tydz ? ` · tydzień ${tydz}` : ''}</small><h2>${esc(dzis.nazwa)}</h2><p>Dziś według planu.</p>`
    : `<small>${esc(dataTekst)}</small><h2>Dzień wolny</h2><p>Następny według planu: ${esc(nastepny.dzien.toLowerCase())}, ${esc(nastepny.nazwa)}. Możesz też zrobić dowolny dzień.</p>`;

  const aktywny = S.aktywny
    ? `<button class="karta-cw trwa" data-a="wroc"><span class="miniatura puste">▶</span><span class="n"><b>Trwa: ${esc(dzien(S.aktywny.dzienId)?.nazwa || '')}</b><span>Wróć do treningu</span></span><span class="licz" id="zegar-treningu"></span></button>`
    : '';

  const lista = wyb.cwiczenia.map((c) => {
    const o = ostatnioKrotko(c);
    return `<li>${miniatura(c)}<span class="n"><b>${esc(c.nazwa)}</b><span>${o ? 'Ostatnio: ' + esc(o) : esc(c.cel)}</span></span></li>`;
  }).join('');

  return `
  <div class="pasek"><span style="min-width:64px"></span><h1>Trening</h1><button class="prawy" data-a="historia">Historia</button></div>
  ${aktywny}
  <div class="witaj">${naglowek}</div>
  <div class="dni">${PLAN.map((d) => `<button class="dzien ${d.id === V.dzienId ? 'wybrany' : ''} ${zrob.has(d.id) ? 'zrobiony' : ''}" data-a="dzien" data-id="${d.id}"><b>${esc(d.krotko)}</b><span>${esc(d.nazwa.replace(' + brzuch', ''))}</span></button>`).join('')}</div>
  <div class="sekcja"><h3>${esc(wyb.nazwa)} · ${wyb.cwiczenia.length} ćwiczeń</h3></div>
  <div class="podglad"><ul>${lista}</ul></div>
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
    <summary><span class="miniatura puste">🔥</span><b>Rozgrzewka</b><span>${rozgZrob}/${d.rozgrzewka.length}</span></summary>
    ${d.rozgrzewka.map((r, i) => `<button class="punkt ${t.rozgrzewka?.includes(i) ? 'z' : ''}" data-a="rozg" data-i="${i}">
      <span class="ptaszek">✓</span><span class="n"><b>${esc(r.nazwa)}</b><span>${esc(r.ile)}${r.rada ? ' · ' + esc(r.rada) : ''}</span></span></button>`).join('')}
  </details>`;

  const karty = cw.map((c) => {
    const cel = parsujCel(c.cel);
    const z = zrobione(t, c.id);
    const n = z.length;
    const stan = n >= cel.serie ? 'gotowe' : n > 0 ? 'trwa' : '';
    const o = ostatnioKrotko(c);
    const opis = n ? serieTekst(z, cel.jednostka) : (o ? 'Ostatnio: ' + o : c.cel);
    return `<button class="karta-cw ${stan}" data-a="cw" data-id="${esc(c.id)}">${miniatura(c)}
      <span class="n"><b>${esc(c.nazwa)}</b><span>${esc(opis)}</span>
      <span class="kropki">${Array.from({ length: Math.max(cel.serie, n) }, (_, i) => `<i class="${i < n ? 'z' : ''}"></i>`).join('')}</span></span>
      <span class="licz">${n >= cel.serie ? '✓' : `${n}/${cel.serie}`}</span></button>`;
  }).join('');

  return `
  <div class="pasek"><button class="wstecz" data-a="dom">Start</button><h1>${esc(d.nazwa)}</h1><span class="zegar" id="zegar-treningu"></span></div>
  <div class="postep"><i style="width:${cw.length ? (gotowe / cw.length) * 100 : 0}%"></i></div>
  ${rozg}
  <div class="sekcja"><h3>Ćwiczenia · ${gotowe}/${cw.length}</h3><span style="font-size:13px;color:var(--ciemny)">w dowolnej kolejności</span></div>
  ${karty}
  <button class="dodaj-cw" data-a="dodaj">+ Ćwiczenie spoza planu</button>
  ${d.naKoniec ? `<div class="sekcja"><h3>Na koniec</h3></div><div class="rada">${esc(d.naKoniec)}</div>` : ''}
  <div class="dolny"><div><button class="drugi pelny" data-a="zakoncz">Zakończ trening</button></div></div>`;
}

// ----- Ekran ćwiczenia: wiersze serii -----
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
  const p = propozycjaCw(k.t, k.c);
  if (!p) return '';
  const wstawione = k.w.serie.filter((s) => !s.z).every((s) => Number(s.kg) === p.kg && Number(s.powt) === p.powt);
  const ile = k.cel.jednostka === 's' ? `${p.powt} s` : `${p.powt} powt.`;
  const co = p.kg ? `${formatKg(p.kg)} kg × ${ile}` : `bez ciężaru × ${ile}`;
  return `<button class="propozycja ${p.start ? 'start' : ''} ${wstawione ? 'wstawiona' : ''}" data-a="wstaw">
    <span class="pr-tekst"><small>${p.start ? 'Propozycja startowa' : 'Propozycja na dziś'}</small><b>${esc(co)}</b><span>${esc(p.powod)}${p.start && k.c.startUwaga ? ' (' + esc(k.c.startUwaga) + ')' : ''}</span></span>
    <span class="pr-przycisk">${wstawione ? '✓ Jest' : 'Wstaw'}</span></button>`;
}

function htmlSerii(k) {
  const { c, cel, w, akt, krok } = k;
  const jedn = cel.jednostka === 's' ? 'sek' : 'powt.';
  const krokP = cel.jednostka === 's' ? 5 : 1;
  const wiersze = w.serie.map((s, i) => {
    return `<div class="wiersz ${s.z ? 'z' : ''} ${i === akt ? 'akt' : ''}" data-i="${i}">
      <span class="nr">${i + 1}</span>
      <input class="liczba" data-pole="kg" data-i="${i}" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" aria-label="Seria ${i + 1}: kg" value="${esc(formatKg(s.kg) || '0')}">
      <input class="liczba" data-pole="powt" data-i="${i}" type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="off" aria-label="Seria ${i + 1}: ${jedn}" value="${esc(s.powt)}">
      <button class="ptak" data-a="odhacz" data-i="${i}" aria-label="${s.z ? 'Odznacz' : 'Odhacz'} serię ${i + 1}" aria-pressed="${s.z}">✓</button>
      ${s.z ? '' : `<div class="kroki kg"><button data-a="krok" data-i="${i}" data-p="kg" data-o="${-krok}" aria-label="mniej kg">−${formatKg(krok)}</button><button data-a="krok" data-i="${i}" data-p="kg" data-o="${krok}" aria-label="więcej kg">+${formatKg(krok)}</button></div>
      <div class="kroki powt"><button data-a="krok" data-i="${i}" data-p="powt" data-o="${-krokP}" aria-label="mniej">−${krokP}</button><button data-a="krok" data-i="${i}" data-p="powt" data-o="${krokP}" aria-label="więcej">+${krokP}</button></div>
      ${i > 0 ? `<button class="jak" data-a="jak-poprzednia" data-i="${i}" aria-label="Jak seria ${i}" title="Jak seria ${i}">⧉<small>jak ${i}</small></button>` : ''}`}
    </div>`;
  }).join('');
  return `<div class="naglowki"><span>Seria</span><span>kg${c.hantle ? ' / hantel' : ''}</span><span>${jedn}</span><span>✓</span></div>
    ${wiersze}
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
  const { c, lista, idx, w } = k;
  const o = ostatnioCw(c);
  const zdj = c.zdjecia?.length && V.zdjecie
    ? `<div class="anim">${c.zdjecia.map((z) => `<img src="${esc(z)}" alt="">`).join('')}${c.yt ? `<a class="yt" href="${esc(c.yt)}" target="_blank" rel="noopener">▶ Technika</a>` : ''}</div>`
    : '';
  const oceny = `<div class="podpis">Jak szło to ćwiczenie?</div><div class="oceny">${Object.entries(OCENY).map(([key, n]) => `<button class="${key} ${w.ocena === key ? 'on' : ''}" data-a="ocena" data-k="${key}">${key === 'ok' ? 'OK' : n[0].toUpperCase() + n.slice(1)}</button>`).join('')}</div>`;

  return `
  <div class="pasek"><button class="wstecz" data-a="lista">Lista</button><h1>${idx + 1} z ${lista.length}</h1><span class="zegar" id="zegar-treningu"></span></div>
  ${zdj}
  <div class="naglowek-cw">
    <div><h2 class="tytul-cw">${esc(c.nazwa)}</h2>
    <p class="cel-cw"><b>${esc(c.cel)}</b>${c.przerwa ? ` · przerwa ${esc(c.przerwa)}` : ''}</p></div>
    ${c.zdjecia?.length && !V.zdjecie ? `<button data-a="zdjecie" aria-label="Pokaż jak wykonać">${miniatura(c)}</button>` : ''}
  </div>
  ${c.rada ? `<details class="rada"><summary>Technika</summary><p>${esc(c.rada)}</p>${c.uwaga ? `<p style="color:var(--szary)">${esc(c.uwaga)}</p>` : ''}${c.yt ? `<p><a href="${esc(c.yt)}" target="_blank" rel="noopener">▶ Filmy z techniką (YouTube)</a></p>` : ''}</details>` : ''}
  ${o ? `<p class="ostatnio">Ostatnio (${esc(dataKrotka(o.data))}${o.znane ? ', zapis Trenera' : ''}): <b>${esc(serieTekst(o.serie, k.cel.jednostka))}</b>${o.ocena ? ' · ' + OCENY[o.ocena] : ''}</p>` : ''}
  <div id="propozycja">${htmlPropozycji(k)}</div>
  <div class="serie" id="serie">${htmlSerii(k)}</div>
  ${oceny}
  <div class="dolny" id="dol">${htmlDolu(k)}</div>`;
}

/** Odświeża tylko serie, propozycję i dolny przycisk (bez przewijania i bez przerysowania reszty). */
function odswiezCwiczenie() {
  if (V.ekran !== 'cwiczenie') return;
  const k = kontekstCw();
  $('#propozycja').innerHTML = htmlPropozycji(k);
  $('#serie').innerHTML = htmlSerii(k);
  $('#dol').innerHTML = htmlDolu(k);
}
/** Po wpisaniu liczby: tylko etykieta dolnego przycisku i stan propozycji. */
function odswiezEtykiety() {
  const k = kontekstCw();
  const opis = $('#glowny-opis');
  const nr = Number($('#glowny-seria')?.dataset.i);
  if (opis && k.w.serie[nr]) opis.textContent = opisSerii(k.w.serie[nr], k.cel);
  $('#propozycja').innerHTML = htmlPropozycji(k);
}
/** Następna seria zasłonięta przez pasek przerwy albo dolny przycisk: przewiń łagodnie tylko tyle, żeby była widać. */
function pokazAktywny() {
  const r = $('.wiersz.akt') || $('.wiersz:not(.z)');
  if (!r) return;
  const zaslony = [$('#przerwa'), $('#dol')].filter((e) => e && !e.hidden).map((e) => e.getBoundingClientRect().top);
  const granica = Math.min(window.innerHeight, ...zaslony) - 8;
  const dol = r.getBoundingClientRect().bottom;
  if (dol > granica) window.scrollBy({ top: dol - granica, behavior: 'smooth' });
}
function ustawAktywny(i) {
  V.akt = i;
  document.querySelectorAll('.wiersz').forEach((r) => r.classList.toggle('akt', Number(r.dataset.i) === i));
  $('#dol').innerHTML = htmlDolu(kontekstCw());
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
function pytanie({ tytul, tekst = '', tak = 'Tak', nie = 'Anuluj', pole = null, groznie = false }) {
  return new Promise((ok) => {
    const d = document.createElement('dialog');
    d.innerHTML = `<h3>${esc(tytul)}</h3>${tekst ? `<p>${esc(tekst)}</p>` : ''}
      ${pole ? `<input type="text" id="dl-pole" placeholder="${esc(pole)}" autocomplete="off">` : ''}
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
    if (pole) $('#dl-pole', d).focus();
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
  if (!s) return;
  s[pole] = wartosc;
  s.auto = false;
  zapisz();
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a]');
  if (!b) return;
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
    case 'zdjecie': V.zdjecie = true; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
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
      const pole = $(`.liczba[data-pole="${p}"][data-i="${i}"]`);
      if (pole) pole.value = p === 'kg' ? formatKg(nowa) : String(nowa);
      odswiezEtykiety();
      wibruj(8);
      break;
    }
    case 'odhacz': {
      if (document.activeElement?.classList.contains('liczba')) document.activeElement.blur();
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
    case 'jak-poprzednia': {
      const k = kontekstCw();
      const i = Number(b.dataset.i);
      const pop = k.w.serie[i - 1];
      Object.assign(k.w.serie[i], { kg: pop.kg, powt: pop.powt, auto: false });
      V.akt = i;
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
      const p = propozycjaCw(k.t, k.c);
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
  if (el.classList?.contains('liczba') && V.ekran === 'cwiczenie') {
    const i = Number(el.dataset.i);
    const v = el.dataset.pole === 'kg' ? zaokr(liczba(el.value)) : Math.max(0, Math.round(liczba(el.value)));
    zmienPole(i, el.dataset.pole, v);
    odswiezEtykiety();
  }
  if (el.id === 'notatka') {
    const tr = S.historia.find((h) => h.id === V.koniecId);
    if (tr) { tr.notatka = el.value.trim(); zapisz(); $('#tekst').textContent = podsumowanie(tr, PLAN); }
  }
});

// Tapnięcie w pole serii: ten wiersz staje się aktywny (bez przerysowania, klawiatura zostaje).
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!el.classList?.contains('liczba')) return;
  const i = Number(el.dataset.i);
  if (V.akt !== i) ustawAktywny(i);
  setTimeout(() => el.select(), 0);
});
// Po wyjściu z pola: liczba w ładnym formacie (52.5 -> 52,5).
document.addEventListener('focusout', (e) => {
  const el = e.target;
  if (!el.classList?.contains('liczba') || V.ekran !== 'cwiczenie') return;
  const s = kontekstCw().w.serie[Number(el.dataset.i)];
  if (s) el.value = el.dataset.pole === 'kg' ? formatKg(s.kg) || '0' : String(s.powt);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList?.contains('liczba')) e.target.blur();
});

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
