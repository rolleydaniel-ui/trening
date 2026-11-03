// Czysta logika apki (bez DOM): parsowanie planu, podpowiedzi serii, podsumowanie.
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

/**
 * Który dzień planu jest "dziś". Daniel ćwiczy ok. 1:00 w nocy, więc do 5:00
 * liczy się jeszcze poprzedni dzień (trening należy do dnia planu, nie do daty zapisu).
 */
export function dzienPlanu(teraz, plan) {
  const d = new Date(teraz.getTime() - (teraz.getHours() < 5 ? DZIEN_MS : 0));
  const dzis = plan.find((x) => x.dzienTygodnia === d.getDay()) || null;
  let nastepny = null;
  for (let i = 1; i <= 7 && !nastepny; i++) {
    const dz = new Date(d.getTime() + i * DZIEN_MS).getDay();
    nastepny = plan.find((x) => x.dzienTygodnia === dz) || null;
  }
  return { dzis, nastepny, data: dataISO(d) };
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

/** Jedna seria jako tekst: "52,5×8", "40 s", "20 kg × 30 s". */
export function seriaTekst(s, jednostka) {
  const ile = jednostka === 's' ? `${s.powt} s` : String(s.powt);
  if (!s.kg) return ile;
  return jednostka === 's' ? `${formatKg(s.kg)} kg × ${ile}` : `${formatKg(s.kg)}×${ile}`;
}

/** Ostatni zakończony trening z seriami danego ćwiczenia. */
export function ostatnio(historia, cwId) {
  for (let i = historia.length - 1; i >= 0; i--) {
    const c = historia[i].cwiczenia?.[cwId];
    if (c && c.serie && c.serie.length) return { data: historia[i].dataPlanu, serie: c.serie, ocena: c.ocena || '' };
  }
  return null;
}

/** Najcięższa seria w historii (do wykrywania rekordów). */
export function najwiekszyCiezar(historia, cwId) {
  let max = 0;
  for (const t of historia) for (const s of t.cwiczenia?.[cwId]?.serie || []) max = Math.max(max, Number(s.kg) || 0);
  return max;
}

/**
 * Co wpisać w następną serię: tak jak poprzednia seria dziś, a na pierwszą serię
 * tak jak ta sama seria ostatnio. Bez historii: stary zapis kg z poprzedniej apki albo 0.
 */
export function podpowiedzSerii({ dzis = [], ostatnieSerie = [], cel, kgZapasowe = 0 }) {
  const n = dzis.length;
  if (n > 0) return { kg: dzis[n - 1].kg, powt: dzis[n - 1].powt };
  const ost = ostatnieSerie[n] || ostatnieSerie[ostatnieSerie.length - 1];
  if (ost) return { kg: ost.kg, powt: ost.powt };
  return { kg: kgZapasowe || 0, powt: cel.min };
}

/** Sugestia progresji na podstawie ostatniego razu (podwójna progresja). */
export function sugestia(ostatnieSerie, cel, krok = 2.5) {
  if (!ostatnieSerie || !ostatnieSerie.length || cel.jednostka === 's') return '';
  const robocze = ostatnieSerie.slice(0, cel.serie);
  const kg = Math.max(...robocze.map((s) => Number(s.kg) || 0));
  if (!kg) return '';
  const wszystkieGora = robocze.length >= cel.serie && robocze.every((s) => Number(s.kg) >= kg && s.powt >= cel.max);
  if (wszystkieGora) return `Ostatnio górna granica we wszystkich seriach: spróbuj ${formatKg(kg + krok)} kg.`;
  return `Cel: ${formatKg(kg)} kg i więcej powtórzeń (do ${cel.max}).`;
}

export const OCENY = { lekko: 'lekko', ok: 'ok', ciezko: 'ciężko' };

/** Tekst do wklejenia Trenerowi na Discordzie. */
export function podsumowanie(trening, plan) {
  const dzien = plan.find((d) => d.id === trening.dzienId);
  const [r, m, d] = trening.dataPlanu.split('-');
  const czas = trening.koniec ? `, ${formatCzasTrwania(trening.koniec - trening.start)}` : '';
  const linie = [`Byłem: ${dzien ? dzien.nazwa : trening.nazwa} (${d}.${m}.${r})${czas}`];
  for (const cw of listaCwiczen(trening, plan)) {
    const c = trening.cwiczenia[cw.id];
    if (!c || !c.serie.length) continue;
    const jedn = parsujCel(cw.cel).jednostka;
    const ocena = c.ocena ? ` · ${OCENY[c.ocena]}` : '';
    linie.push(`- ${cw.nazwa}: ${c.serie.map((s) => seriaTekst(s, jedn)).join(', ')}${ocena}`);
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
