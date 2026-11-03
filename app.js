import { PLAN } from './plan.js';
import {
  parsujCel, przerwaSekundy, dzienPlanu, formatKg, formatCzas, formatCzasTrwania, seriaTekst,
  ostatnio, podpowiedzSerii, dataISO, sugestia, podsumowanie, statystyki, rekordy, listaCwiczen, OCENY,
} from './logika.js';

// ---------- Stan i zapis ----------
const KLUCZ = 'trening.v2';
const DOMYSLNE = { aktywny: null, historia: [], ustawienia: { dzwiek: true, wibracje: true, ekran: true, krokKg: 2.5 } };

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
let V = { ekran: S.aktywny ? 'trening' : 'start', dzienId: null, cwId: null, edycja: null, koniecId: null };
const szkic = {}; // wpisywane, jeszcze niezapisane wartości serii: { [cwId]: { kg, powt } }

const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dzien = (id) => PLAN.find((d) => d.id === id);
const teraz = () => Date.now();

function cwiczenieTreningu(t, cwId) {
  return listaCwiczen(t, PLAN).find((c) => c.id === cwId);
}
function wpisCw(t, cwId) {
  if (!t.cwiczenia[cwId]) t.cwiczenia[cwId] = { serie: [], ocena: '' };
  return t.cwiczenia[cwId];
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
  if (S.ustawienia.wibracje && navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 500]);
}

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
  toastTimer = setTimeout(() => { el.hidden = true; el._cofnij = null; }, cofnij ? 5000 : 2200);
}

// ---------- Przerwa ----------
function startPrzerwy(sek, cwId) {
  const t = S.aktywny;
  t.przerwa = { koniec: teraz() + sek * 1000, dlugosc: sek, cwId, pikniete: false };
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

function htmlDuzejPrzerwy() {
  return `<div class="duza-przerwa" id="duza-przerwa">
    <small id="dp-tytul">Przerwa</small>
    <div class="czas" id="dp-czas">0:00</div>
    <div class="pasek-p"><i id="dp-pasek" style="width:0"></i></div>
    <div class="akcje">
      <button data-a="przerwa" data-o="-15">−15 s</button>
      <button data-a="przerwa" data-o="15">+15 s</button>
      <button data-a="pomin">Pomiń</button>
    </div></div>`;
}

// Odświeżanie zegarów bez przerysowania ekranu (żeby nie gubić wpisywanych liczb).
function tyk() {
  const t = S.aktywny;
  const zeg = $('#zegar-treningu');
  if (zeg && t) zeg.textContent = formatCzas((teraz() - t.start) / 1000);

  const p = t?.przerwa;
  const maly = $('#przerwa');
  const duzy = $('#duza-przerwa');
  if (!p) {
    maly.hidden = true;
    if (duzy) duzy.remove();
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

  const naEkranieCw = V.ekran === 'cwiczenie';
  if (naEkranieCw) {
    maly.hidden = true;
    if (!duzy) {
      const miejsce = $('#miejsce-przerwy');
      if (miejsce) miejsce.innerHTML = htmlDuzejPrzerwy();
    }
    const d = $('#duza-przerwa');
    if (d) {
      d.classList.toggle('koniec', po);
      $('#dp-tytul').textContent = po ? 'Czas na serię' : 'Przerwa';
      $('#dp-czas').textContent = tekst;
      $('#dp-pasek').style.width = `${Math.min(100, Math.max(0, (1 - zostalo / p.dlugosc) * 100))}%`;
      $('[data-a="pomin"]', d).textContent = po ? 'OK' : 'Pomiń';
    }
  } else if (['trening', 'cwiczenie'].includes(V.ekran)) {
    const cw = cwiczenieTreningu(t, p.cwId);
    maly.hidden = false;
    maly.classList.toggle('koniec', po);
    maly.innerHTML = `<div style="flex:1;min-width:0"><small>${po ? 'Czas na serię' : 'Przerwa'}${cw ? ' · ' + esc(cw.nazwa) : ''}</small><div class="czas">${tekst}</div></div>
      ${po ? '' : '<button data-a="przerwa" data-o="15">+15</button>'}
      ${cw ? `<button data-a="cw" data-id="${esc(cw.id)}">Wróć</button>` : ''}
      <button data-a="pomin">${po ? 'OK' : 'Pomiń'}</button>`;
  } else {
    maly.hidden = true;
  }
}
setInterval(tyk, 250);

// ---------- Ekrany ----------
function render() {
  const app = $('#app');
  const widoki = { start: ekranStart, trening: ekranTrening, cwiczenie: ekranCwiczenie, koniec: ekranKoniec, historia: ekranHistoria, ustawienia: ekranUstawienia };
  if (V.ekran === 'trening' && !S.aktywny) V.ekran = 'start';
  if (V.ekran === 'cwiczenie' && (!S.aktywny || !cwiczenieTreningu(S.aktywny, V.cwId))) V.ekran = S.aktywny ? 'trening' : 'start';
  app.innerHTML = (widoki[V.ekran] || ekranStart)();
  tyk();
  if (S.aktywny) trzymajEkran(); else pusc();
}

function idz(ekran, zmiany = {}) {
  V = { ...V, ekran, edycja: null, ...zmiany };
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
  const o = ostatnio(S.historia, cw.id);
  if (!o) return '';
  const jedn = parsujCel(cw.cel).jednostka;
  return o.serie.map((s) => seriaTekst(s, jedn)).join(', ');
}

function zrobioneDzis(dataPlanu) {
  return new Set(S.historia.filter((h) => h.dataPlanu >= dataPlanu).map((h) => h.dzienId));
}

function ekranStart() {
  const { dzis, nastepny, data } = dzienPlanu(new Date(), PLAN);
  if (!V.dzienId) V.dzienId = (dzis || nastepny || PLAN[0]).id;
  const wyb = dzien(V.dzienId);
  const dt = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
  const dataTekst = dt[0].toUpperCase() + dt.slice(1);
  const tydzien = new Date(data + 'T12:00');
  tydzien.setDate(tydzien.getDate() - ((tydzien.getDay() + 6) % 7));
  const zrobione = zrobioneDzis(dataISO(tydzien));

  const naglowek = dzis
    ? `<small>${esc(dataTekst)}</small><h2>${esc(dzis.nazwa)}</h2><p>Dziś według planu.</p>`
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
  <div class="dni">${PLAN.map((d) => `<button class="dzien ${d.id === V.dzienId ? 'wybrany' : ''} ${zrobione.has(d.id) ? 'zrobiony' : ''}" data-a="dzien" data-id="${d.id}"><b>${esc(d.krotko)}</b><span>${esc(d.nazwa.replace(' + brzuch', ''))}</span></button>`).join('')}</div>
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
  const gotowe = cw.filter((c) => (t.cwiczenia[c.id]?.serie.length || 0) >= parsujCel(c.cel).serie).length;
  const rozgZrob = d.rozgrzewka.filter((_, i) => t.rozgrzewka?.includes(i)).length;

  const rozg = `<details class="rozgrzewka" ${rozgZrob < d.rozgrzewka.length && !Object.keys(t.cwiczenia).length ? 'open' : ''}>
    <summary><span class="miniatura puste">🔥</span><b>Rozgrzewka</b><span>${rozgZrob}/${d.rozgrzewka.length}</span></summary>
    ${d.rozgrzewka.map((r, i) => `<button class="punkt ${t.rozgrzewka?.includes(i) ? 'z' : ''}" data-a="rozg" data-i="${i}">
      <span class="ptaszek">✓</span><span class="n"><b>${esc(r.nazwa)}</b><span>${esc(r.ile)}${r.rada ? ' · ' + esc(r.rada) : ''}</span></span></button>`).join('')}
  </details>`;

  const karty = cw.map((c) => {
    const cel = parsujCel(c.cel);
    const n = t.cwiczenia[c.id]?.serie.length || 0;
    const stan = n >= cel.serie ? 'gotowe' : n > 0 ? 'trwa' : '';
    const dzisTekst = n ? t.cwiczenia[c.id].serie.map((s) => seriaTekst(s, cel.jednostka)).join(', ') : '';
    const o = ostatnioKrotko(c);
    const opis = dzisTekst || (o ? 'Ostatnio: ' + o : c.cel);
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

function wartosciWpisu(t, c) {
  const cel = parsujCel(c.cel);
  const e = V.edycja;
  if (e && e.cwId === c.id) return t.cwiczenia[c.id].serie[e.i];
  if (szkic[c.id]) return szkic[c.id];
  const o = ostatnio(S.historia, c.id);
  return podpowiedzSerii({ dzis: t.cwiczenia[c.id]?.serie || [], ostatnieSerie: o?.serie || [], cel, kgZapasowe: stareKg[c.nazwa]?.kg || 0 });
}

function ekranCwiczenie() {
  const t = S.aktywny;
  const lista = listaCwiczen(t, PLAN);
  const idx = lista.findIndex((c) => c.id === V.cwId);
  const c = lista[idx];
  const cel = parsujCel(c.cel);
  const w = wpisCw(t, c.id);
  const o = ostatnio(S.historia, c.id);
  const sug = sugestia(o?.serie, cel);
  const v = wartosciWpisu(t, c);
  const edycja = V.edycja && V.edycja.cwId === c.id ? V.edycja : null;
  const nr = edycja ? edycja.i + 1 : w.serie.length + 1;
  const jedn = cel.jednostka === 's' ? 's' : 'powt';
  const krok = S.ustawienia.krokKg;
  const nastepne = lista.slice(idx + 1).concat(lista.slice(0, idx)).find((x) => (t.cwiczenia[x.id]?.serie.length || 0) < parsujCel(x.cel).serie);
  const celOsiagniety = w.serie.length >= cel.serie;

  const duzeZdj = V.zdjecie ?? (!w.serie.length && !t.przerwa);
  const zdj = c.zdjecia?.length && duzeZdj
    ? `<div class="anim">${c.zdjecia.map((z) => `<img src="${esc(z)}" alt="">`).join('')}${c.yt ? `<a class="yt" href="${esc(c.yt)}" target="_blank" rel="noopener">▶ Technika</a>` : ''}</div>`
    : '';

  const serie = w.serie.map((s, i) => `<button class="seria" data-a="edytuj" data-i="${i}" ${edycja && edycja.i === i ? 'style="outline:1.5px solid var(--przerwa)"' : ''}>
      <span class="nr">${i + 1}</span><span class="w">${s.kg ? `${formatKg(s.kg)} <small>kg</small> × ` : ''}${s.powt} <small>${jedn}</small></span>
      <span class="ed">${o?.serie[i] ? 'ostatnio ' + esc(seriaTekst(o.serie[i], cel.jednostka)) : 'zmień'}</span></button>`).join('');

  const wpis = `<div class="wpis ${edycja ? 'edycja' : ''}">
    <h4><span>${edycja ? `Poprawiasz serię ${nr}` : `Seria ${nr}${nr > cel.serie ? ' (dodatkowa)' : ` z ${cel.serie}`}`}</span><span>cel ${cel.min}${cel.max !== cel.min ? '-' + cel.max : ''} ${jedn}${cel.naStrone ? ' / str.' : ''}</span></h4>
    <div class="pole"><label for="kg">kg</label><button class="krok" data-a="krok" data-p="kg" data-o="${-krok}" aria-label="mniej kg">−</button>
      <input id="kg" inputmode="decimal" enterkeyhint="done" autocomplete="off" value="${esc(formatKg(v.kg) || '0')}"><button class="krok" data-a="krok" data-p="kg" data-o="${krok}" aria-label="więcej kg">+</button></div>
    <div class="pole"><label for="powt">${jedn}</label><button class="krok" data-a="krok" data-p="powt" data-o="${cel.jednostka === 's' ? -5 : -1}" aria-label="mniej">−</button>
      <input id="powt" inputmode="numeric" enterkeyhint="done" autocomplete="off" value="${esc(v.powt)}"><button class="krok" data-a="krok" data-p="powt" data-o="${cel.jednostka === 's' ? 5 : 1}" aria-label="więcej">+</button></div>
    ${edycja ? `<div class="akcje"><button class="drugi" data-a="usun-serie">Usuń</button><button class="drugi" data-a="anuluj-edycje">Anuluj</button><button class="glowny" data-a="zapisz-edycje">Zapisz</button></div>` : ''}
  </div>`;

  const oceny = w.serie.length ? `<div class="podpis">Jak szło to ćwiczenie?</div><div class="oceny">${Object.entries(OCENY).map(([k, n]) => `<button class="${k} ${w.ocena === k ? 'on' : ''}" data-a="ocena" data-k="${k}">${k === 'ok' ? 'OK' : n[0].toUpperCase() + n.slice(1)}</button>`).join('')}</div>` : '';

  const dol = edycja ? '' : `<div class="dolny"><div>
    ${celOsiagniety && nastepne ? `<button class="drugi" data-a="seria" aria-label="Dodatkowa seria">+ Seria</button><button class="glowny dalej" data-a="cw" data-id="${esc(nastepne.id)}">Dalej ›<small>${esc(skrot(nastepne.nazwa))}</small></button>`
      : celOsiagniety ? '<button class="drugi" data-a="seria">+ Seria</button><button class="glowny" data-a="lista">Gotowe</button>'
        : `<button class="glowny" data-a="seria">✓ Zrobiona seria ${nr}</button>`}
  </div></div>`;

  return `
  <div class="pasek"><button class="wstecz" data-a="lista">Lista</button><h1>${idx + 1} z ${lista.length}</h1><span class="zegar" id="zegar-treningu"></span></div>
  <div id="miejsce-przerwy"></div>
  ${zdj}
  <div class="naglowek-cw">
    <div><h2 class="tytul-cw">${esc(c.nazwa)}</h2>
    <p class="cel-cw"><b>${esc(c.cel)}</b>${c.przerwa ? ` · przerwa ${esc(c.przerwa)}` : ''}</p></div>
    ${c.zdjecia?.length && !duzeZdj ? `<button data-a="zdjecie" aria-label="Pokaż jak wykonać">${miniatura(c)}</button>` : ''}
  </div>
  ${c.rada ? `<details class="rada" ${V.technika ? 'open' : ''}><summary>Technika</summary><p>${esc(c.rada)}</p>${c.uwaga ? `<p style="color:var(--szary)">${esc(c.uwaga)}</p>` : ''}${c.yt ? `<p><a href="${esc(c.yt)}" target="_blank" rel="noopener">▶ Filmy z techniką (YouTube)</a></p>` : ''}</details>` : ''}
  ${o ? `<p class="ostatnio">Ostatnio (${esc(dataKrotka(o.data))}): <b>${esc(o.serie.map((s) => seriaTekst(s, cel.jednostka)).join(', '))}</b>${o.ocena ? ' · ' + OCENY[o.ocena] : ''}</p>` : ''}
  ${sug ? `<p class="wskazowka">${esc(sug)}</p>` : '<div style="height:8px"></div>'}
  <div class="serie">${serie}</div>
  ${wpis}
  ${oceny}
  ${dol}`;
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
  <div class="dolny"><div><button class="drugi" data-a="dom">Gotowe</button><button class="glowny" data-a="kopiuj" data-id="${esc(t.id)}">Kopiuj dla Trenera</button></div></div>`;
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
    ${prz('dzwiek', 'Dźwięk na koniec przerwy')}
    ${prz('wibracje', 'Wibracja na koniec przerwy (Android)')}
    ${prz('ekran', 'Ekran nie gaśnie w trakcie treningu')}
    <label class="przelacznik"><span>Krok ciężaru (+/−)</span><select data-u="krokKg">${[1, 1.25, 2, 2.5, 5].map((k) => `<option value="${k}" ${u.krokKg === k ? 'selected' : ''}>${formatKg(k)} kg</option>`).join('')}</select></label>
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
      const wynik = b.value === 'tak' ? (pole ? $('#dl-pole', d).value.trim() || null : true) : null;
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

function odczytajWpis() {
  return { kg: Math.max(0, Math.round(liczba($('#kg').value) * 100) / 100), powt: Math.max(0, Math.round(liczba($('#powt').value))) };
}

function startTreningu(dzienId) {
  const { data, dzis } = dzienPlanu(new Date(), PLAN);
  // Dzień wolny, a robisz trening z planu: zapisujemy go pod dzisiejszą datą.
  S.aktywny = { id: 't' + teraz().toString(36), dzienId, nazwa: dzien(dzienId).nazwa, dataPlanu: data, start: teraz(), cwiczenia: {}, rozgrzewka: [], dodatkowe: [], przerwa: null, planowy: dzis?.id === dzienId };
  zapisz();
  odblokujDzwiek();
  idz('trening');
}

async function zakonczTrening() {
  const t = S.aktywny;
  const lista = listaCwiczen(t, PLAN);
  const bez = lista.filter((c) => !t.cwiczenia[c.id]?.serie.length).length;
  const st = statystyki(t, PLAN);
  if (!st.serie) {
    const w = await pytanie({ tytul: 'Nie ma żadnej serii', tekst: 'Odrzucić ten trening?', tak: 'Odrzuć', nie: 'Wróć', groznie: true });
    if (w) { S.aktywny = null; zapisz(); idz('start'); }
    return;
  }
  const w = await pytanie({ tytul: 'Zakończyć trening?', tekst: bez ? `${bez} ${bez === 1 ? 'ćwiczenie jest' : 'ćwiczeń jest'} bez żadnej serii, trafią na listę pominiętych.` : 'Wszystko zrobione. Dobra robota.', tak: 'Zakończ', nie: 'Jeszcze nie' });
  if (!w) return;
  const { przerwa, ...reszta } = t;
  const gotowy = { ...reszta, koniec: teraz() };
  for (const k of Object.keys(gotowy.cwiczenia)) if (!gotowy.cwiczenia[k].serie.length) delete gotowy.cwiczenia[k];
  S.historia.push(gotowy);
  $('#toast').hidden = true;
  S.aktywny = null;
  zapisz();
  pusc();
  idz('koniec', { koniecId: gotowy.id });
}

async function kopiuj(tekst) {
  try {
    await navigator.clipboard.writeText(tekst);
    toast('Skopiowane. Wklej na kanale #trener.');
  } catch {
    const a = document.createElement('textarea');
    a.value = tekst;
    document.body.append(a);
    a.select();
    try { document.execCommand('copy'); toast('Skopiowane. Wklej na kanale #trener.'); } catch { toast('Nie udało się skopiować, zaznacz tekst ręcznie.'); }
    a.remove();
  }
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
    case 'cw': idz('cwiczenie', { cwId: b.dataset.id, zdjecie: null }); break;
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
      const pole = $('#' + b.dataset.p);
      const o = Number(b.dataset.o);
      const nowa = Math.max(0, Math.round((liczba(pole.value) + o) * 100) / 100);
      pole.value = b.dataset.p === 'kg' ? formatKg(nowa) : String(nowa);
      if (!V.edycja) szkic[V.cwId] = odczytajWpis();
      if (navigator.vibrate && S.ustawienia.wibracje) navigator.vibrate(8);
      break;
    }
    case 'seria': {
      const c = cwiczenieTreningu(t, V.cwId);
      const w = wpisCw(t, c.id);
      const s = { ...odczytajWpis(), t: teraz() };
      w.serie.push(s);
      delete szkic[c.id];
      const cel = parsujCel(c.cel);
      startPrzerwy(przerwaSekundy(c.przerwa), c.id);
      zapisz();
      render();
      toast(`Seria ${w.serie.length}: ${seriaTekst(s, cel.jednostka)}`, () => {
        w.serie.pop();
        szkic[c.id] = { kg: s.kg, powt: s.powt };
        S.aktywny.przerwa = null;
        zapisz();
        render();
      });
      break;
    }
    case 'edytuj': V.edycja = { cwId: V.cwId, i: Number(b.dataset.i) }; render(); $('.wpis').scrollIntoView({ behavior: 'smooth', block: 'center' }); break;
    case 'anuluj-edycje': V.edycja = null; render(); break;
    case 'zapisz-edycje': {
      const s = t.cwiczenia[V.cwId].serie[V.edycja.i];
      Object.assign(s, odczytajWpis());
      V.edycja = null;
      zapisz();
      render();
      break;
    }
    case 'usun-serie': {
      const w = t.cwiczenia[V.cwId];
      const i = V.edycja.i;
      const [s] = w.serie.splice(i, 1);
      V.edycja = null;
      zapisz();
      render();
      toast(`Usunięta seria ${i + 1}`, () => { w.serie.splice(i, 0, s); zapisz(); render(); });
      break;
    }
    case 'ocena': {
      const w = wpisCw(t, V.cwId);
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
      if (tr) kopiuj(podsumowanie(tr, PLAN));
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
  if ((e.target.id === 'kg' || e.target.id === 'powt') && !V.edycja && V.cwId) szkic[V.cwId] = odczytajWpis();
  if (e.target.id === 'notatka') {
    const tr = S.historia.find((h) => h.id === V.koniecId);
    if (tr) { tr.notatka = e.target.value.trim(); zapisz(); $('#tekst').textContent = podsumowanie(tr, PLAN); }
  }
});

document.addEventListener('focusin', (e) => {
  if (e.target.id === 'kg' || e.target.id === 'powt') setTimeout(() => e.target.select(), 0);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.target.id === 'kg' || e.target.id === 'powt')) e.target.blur();
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
