// Czysta logika apki (bez DOM): parsowanie planu, propozycje ciężaru, podsumowanie.
// Testy: node --test

const DZIEN_MS = 86400000;

/** "3 x 6-10" -> { serie: 3, min: 6, max: 10, jednostka: 'powt', naStrone: false } */
export function parsujCel(cel) {
  const t = String(cel || '');
  const m = t.match(/(\d+)\s*x\s*(\d+)(?:\s*-\s*(\d+))?\s*(s\b|sek)?/i);
  if (!m) return { serie: 3, min: 10, max: 10, jednostka: 'powt', naStrone: false };
  const min = Number(m[2]);
  return {
    serie: Number(m[1]),
    min,
    max: m[3] ? Number(m[3]) : min,
    jednostka: m[4] ? 's' : 'powt',
    naStrone: /str/.test(t),
  };
}

/** "2-3 min" -> 120, "90-120 s" -> 90, "60 s" -> 60. Bierze dolną granicę. */
export function przerwaSekundy(przerwa, domyslnie = 90) {
  const m = String(przerwa || '').match(/(\d+)(?:\s*-\s*\d+)?\s*(min|s)/i);
  if (!m) return domyslnie;
  return Number(m[1]) * (m[2].toLowerCase() === 'min' ? 60 : 1);
}

export function dataISO(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Do tej godziny liczy się jeszcze poprzedni dzień (trening o 1:00 w nocy należy do wczoraj). */
export const GODZINA_ZMIANY_DNIA = 5;

/** Data "dnia planu" (o 0:30 we wtorek to jeszcze poniedziałek). */
export function dataDniaPlanu(teraz) {
  return new Date(teraz.getTime() - (teraz.getHours() < GODZINA_ZMIANY_DNIA ? DZIEN_MS : 0));
}

/**
 * Który dzień planu jest "dziś". Daniel ćwiczy ok. 1:00 w nocy, więc do 5:00
 * liczy się jeszcze poprzedni dzień (trening należy do dnia planu, nie do daty zapisu).
 */
export function dzienPlanu(teraz, plan) {
  const d = dataDniaPlanu(teraz);
  const dzis = plan.find((x) => x.dzienTygodnia === d.getDay()) || null;
  let nastepny = null;
  for (let i = 1; i <= 7 && !nastepny; i++) {
    const dz = new Date(d.getTime() + i * DZIEN_MS).getDay();
    nastepny = plan.find((x) => x.dzienTygodnia === dz) || null;
  }
  return { dzis, nastepny, data: dataISO(d), poPolnocy: teraz.getHours() < GODZINA_ZMIANY_DNIA };
}

/** Tydzień planu (1 = pierwszy tydzień od startu treningów). */
export function tydzienPlanu(dataPlanu, start) {
  if (!start) return 0;
  const dni = Math.round((new Date(dataPlanu + 'T12:00') - new Date(start + 'T12:00')) / DZIEN_MS);
  return dni < 0 ? 0 : Math.floor(dni / 7) + 1;
}

export function formatKg(kg) {
  if (kg == null || kg === '') return '';
  const n = Math.round(Number(kg) * 100) / 100;
  return String(n).replace('.', ',');
}

export function formatCzas(sek) {
  const s = Math.max(0, Math.round(sek));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export function formatCzasTrwania(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

const ile = (s, jednostka) => (jednostka === 's' ? `${s.powt} s` : String(s.powt));

/** Jedna seria jako tekst: "10x25 kg", "12", "45 s", "45 s x 10 kg". */
export function seriaTekst(s, jednostka) {
  if (!Number(s.kg)) return ile(s, jednostka);
  return `${ile(s, jednostka)}x${formatKg(s.kg)} kg`;
}

/**
 * Serie ćwiczenia jako tekst. Wszystkie takie same: "3x10 · 25 kg" (bez ciężaru: "3x12").
 * Różne: każda osobno, "8x15 kg, 8x17,5 kg, 6x17,5 kg".
 */
export function serieTekst(serie, jednostka) {
  if (!serie || !serie.length) return '';
  const pierwsza = serie[0];
  const takieSame = serie.every((s) => Number(s.kg) === Number(pierwsza.kg) && Number(s.powt) === Number(pierwsza.powt));
  if (takieSame && serie.length > 1) {
    const r = `${serie.length}x${ile(pierwsza, jednostka)}`;
    return Number(pierwsza.kg) ? `${r} · ${formatKg(pierwsza.kg)} kg` : r;
  }
  return serie.map((s) => seriaTekst(s, jednostka)).join(', ');
}

/**
 * Ostatni raz z danym ćwiczeniem: najpierw historia z telefonu, potem wyniki
 * wpisane przez Trenera w planie (znane), inaczej null.
 */
export function ostatnio(historia, cwId, znane = null) {
  for (let i = historia.length - 1; i >= 0; i--) {
    const c = historia[i].cwiczenia?.[cwId];
    if (c && c.serie && c.serie.length) return { data: historia[i].dataPlanu, serie: c.serie, ocena: c.ocena || '' };
  }
  if (znane && znane.serie?.length) return { data: znane.data, serie: znane.serie, ocena: znane.ocena || '', znane: true };
  return null;
}

/** Najcięższa seria w historii (do wykrywania rekordów). */
export function najwiekszyCiezar(historia, cwId) {
  let max = 0;
  for (const t of historia) for (const s of t.cwiczenia?.[cwId]?.serie || []) max = Math.max(max, Number(s.kg) || 0);
  return max;
}

/**
 * Propozycja na dziś (podwójna progresja z planu Trenera):
 * - wszystkie serie na górnej granicy zakresu: + krok (np. 2,5 kg),
 * - przy najcięższym ciężarze poniżej dolnej granicy: - krok,
 * - w zakresie: ten sam ciężar, cel +1 powtórzenie (po "ciężko": te same powtórzenia),
 * - bez historii: ciężar startowy z planu, oznaczony jako start.
 * Zwraca { kg, powt, powod, start } albo null (brak danych).
 */
export function propozycja({ ost = null, cel, startKg, krok = 2.5, tydzien = 0 }) {
  const zapas = tydzien >= 1 && tydzien <= 2 ? ` Tydz. ${tydzien}: zostaw 3-4 powt. w zapasie.` : '';
  const jedn = cel.jednostka === 's' ? 's' : 'powt.';
  const zakres = `${cel.min}${cel.max !== cel.min ? '-' + cel.max : ''} ${jedn}`;
  const serie = (ost?.serie || []).filter((s) => Number(s.powt) > 0);

  if (!serie.length) {
    if (startKg == null) return null;
    if (!Number(startKg)) return { kg: 0, powt: cel.min, start: true, powod: `Start: bez ciężaru, zacznij od ${cel.min} ${jedn}${zapas}` };
    return { kg: Number(startKg), powt: cel.min, start: true, powod: `Start, sprawdź na serii rozgrzewkowej.${zapas}` };
  }

  const kgRef = Math.max(...serie.map((s) => Number(s.kg) || 0));
  const przyRef = serie.filter((s) => (Number(s.kg) || 0) === kgRef);
  const minPowt = Math.min(...przyRef.map((s) => Number(s.powt)));
  const wszystkieGora = serie.length >= cel.serie && serie.every((s) => Number(s.powt) >= cel.max);
  const zaokr = (x) => Math.max(0, Math.round(x * 100) / 100);

  if (cel.jednostka === 's') {
    if (wszystkieGora) return { kg: kgRef, powt: cel.max, start: false, powod: `Ostatnio ${cel.max} s we wszystkich seriach: trzymaj ${cel.max} s albo trudniejsza wersja.${zapas}` };
    const p = Math.min(cel.max, minPowt + 5);
    return { kg: kgRef, powt: p, start: false, powod: `Ostatnio ${minPowt} s: celuj w ${p} s.${zapas}` };
  }

  if (wszystkieGora) {
    if (!kgRef) return { kg: 0, powt: cel.max, start: false, powod: `Ostatnio górna granica (${cel.max}) we wszystkich seriach: wolniejsze tempo albo mały ciężar.${zapas}` };
    return { kg: zaokr(kgRef + krok), powt: cel.min, start: false, powod: `Ostatnio górna granica (${cel.max}) we wszystkich seriach: +${formatKg(krok)} kg, od ${cel.min} powt.${zapas}` };
  }
  if (minPowt < cel.min && kgRef > 0) {
    const kg = zaokr(kgRef - krok);
    return { kg, powt: cel.min, start: false, powod: `Ostatnio ${minPowt} powt. przy ${formatKg(kgRef)} kg, poniżej zakresu ${zakres}: o ${formatKg(krok)} kg mniej.${zapas}` };
  }
  if (ost.ocena === 'ciezko') {
    return { kg: kgRef, powt: Math.max(cel.min, minPowt), start: false, powod: `Ostatnio ciężko: ten sam ciężar i te same powtórzenia, dobra technika.${zapas}` };
  }
  const p = Math.min(cel.max, Math.max(cel.min, minPowt + 1));
  return { kg: kgRef, powt: p, start: false, powod: `W zakresie ${zakres}: ten sam ciężar, cel ${p} powt. (+1).${zapas}` };
}

/**
 * Wiersze serii na start ćwiczenia: tyle, ile serii w planie, wypełnione tym,
 * co było ostatnio (ta sama seria, a jak jej nie było, to ostatnia), bez historii propozycją startową.
 */
export function wierszeStartowe({ cel, ost = null, prop = null }) {
  const serie = ost?.serie || [];
  return Array.from({ length: cel.serie }, (_, i) => {
    const s = serie[i] || serie[serie.length - 1];
    const w = s ? { kg: Number(s.kg) || 0, powt: Number(s.powt) || cel.min }
      : prop ? { kg: prop.kg, powt: prop.powt } : { kg: 0, powt: cel.min };
    return { ...w, z: false, auto: true };
  });
}

/** Seria odhaczona: dalsze nieruszane wiersze dostają te same liczby, jeśli tę serię zmieniałeś. */
export function odhaczSerie(serie, i, czas) {
  const s = serie[i];
  s.z = true;
  s.t = czas;
  if (!s.auto) for (const x of serie.slice(i + 1)) if (!x.z && x.auto) { x.kg = s.kg; x.powt = s.powt; }
  return s;
}

/** Która seria jest teraz do zrobienia (pierwsza nieodhaczona). -1 = wszystkie zrobione. */
export function aktywnaSeria(serie) {
  return serie.findIndex((s) => !s.z);
}

export const OCENY = { lekko: 'lekko', ok: 'ok', ciezko: 'ciężko' };

/** Tekst do wklejenia Trenerowi na Discordzie. */
export function podsumowanie(trening, plan) {
  const dzien = plan.find((d) => d.id === trening.dzienId);
  const [r, m, d] = trening.dataPlanu.split('-');
  const czas = trening.koniec ? `, ${formatCzasTrwania(trening.koniec - trening.start)}` : '';
  const nazwa = dzien ? `${dzien.dzien}: ${dzien.nazwa}` : trening.nazwa;
  const linie = [`Byłem: ${nazwa} (${d}.${m}.${r})${czas}`];
  for (const cw of listaCwiczen(trening, plan)) {
    const c = trening.cwiczenia[cw.id];
    if (!c || !c.serie.length) continue;
    const jedn = parsujCel(cw.cel).jednostka;
    const ocena = c.ocena ? ` · ${OCENY[c.ocena]}` : '';
    linie.push(`${cw.nazwa}: ${serieTekst(c.serie, jedn)}${ocena}`);
  }
  const pominiete = listaCwiczen(trening, plan).filter((cw) => !trening.cwiczenia[cw.id]?.serie?.length);
  if (pominiete.length) linie.push(`Pominięte: ${pominiete.map((c) => c.nazwa).join(', ')}`);
  if (trening.notatka) linie.push(`Notatka: ${trening.notatka}`);
  return linie.join('\n');
}

/** Ćwiczenia z planu dnia + dodane w trakcie. */
export function listaCwiczen(trening, plan) {
  const dzien = plan.find((d) => d.id === trening.dzienId);
  return [...(dzien ? dzien.cwiczenia : []), ...(trening.dodatkowe || [])];
}

export function statystyki(trening, plan) {
  let serie = 0;
  let objetosc = 0;
  let cwiczenia = 0;
  for (const cw of listaCwiczen(trening, plan)) {
    const s = trening.cwiczenia[cw.id]?.serie || [];
    if (s.length) cwiczenia++;
    serie += s.length;
    if (parsujCel(cw.cel).jednostka !== 's') for (const x of s) objetosc += (Number(x.kg) || 0) * (Number(x.powt) || 0);
  }
  return { serie, objetosc: Math.round(objetosc), cwiczenia };
}

/** Rekordy: ćwiczenia, gdzie dziś był większy ciężar niż kiedykolwiek wcześniej. */
export function rekordy(trening, historiaPrzed, plan) {
  const out = [];
  for (const cw of listaCwiczen(trening, plan)) {
    const s = trening.cwiczenia[cw.id]?.serie || [];
    if (!s.length) continue;
    const dzis = Math.max(...s.map((x) => Number(x.kg) || 0));
    const wczesniej = najwiekszyCiezar(historiaPrzed, cw.id);
    if (wczesniej > 0 && dzis > wczesniej) out.push({ nazwa: cw.nazwa, kg: dzis, bylo: wczesniej });
  }
  return out;
}
