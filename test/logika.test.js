import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsujCel, przerwaSekundy, dzienPlanu, formatKg, formatCzas, propozycja, wierszeStartowe,
  odhaczSerie, aktywnaSeria, podsumowanie, serieTekst, statystyki, rekordy, ostatnio, tydzienPlanu,
} from '../logika.js';
import { PLAN, START_TRENINGU } from '../plan.js';

const cwPlanu = (id) => PLAN.flatMap((d) => d.cwiczenia).find((c) => c.id === id);

test('parsujCel: powtórzenia, sekundy, na stronę', () => {
  assert.deepEqual(parsujCel('3 x 6-10'), { serie: 3, min: 6, max: 10, jednostka: 'powt', naStrone: false });
  assert.deepEqual(parsujCel('2 x 30-60 s'), { serie: 2, min: 30, max: 60, jednostka: 's', naStrone: false });
  assert.equal(parsujCel('3 x 12-20 / str.').naStrone, true);
  assert.equal(parsujCel('2 x 20-40 s / str.').jednostka, 's');
});

test('przerwaSekundy bierze dolną granicę', () => {
  assert.equal(przerwaSekundy('2-3 min'), 120);
  assert.equal(przerwaSekundy('90-120 s'), 90);
  assert.equal(przerwaSekundy('60 s'), 60);
  assert.equal(przerwaSekundy(''), 90);
});

test('każde ćwiczenie w planie: cel, przerwa, ciężar startowy, unikalne id', () => {
  const id = new Set();
  for (const d of PLAN) for (const c of d.cwiczenia) {
    const cel = parsujCel(c.cel);
    assert.ok(cel.serie >= 1 && cel.min >= 1, c.nazwa);
    assert.ok(przerwaSekundy(c.przerwa) >= 30, c.nazwa);
    assert.equal(typeof c.startKg, 'number', 'brak startKg: ' + c.nazwa);
    assert.ok(c.krok > 0, c.nazwa);
    assert.ok(!id.has(c.id), 'powtórzone id: ' + c.id);
    id.add(c.id);
  }
  assert.equal(START_TRENINGU, '2026-11-02');
});

test('dzienPlanu: o 0:30 i 1:00 w nocy wtorku liczy się jeszcze poniedziałek, od 5:00 wtorek', () => {
  for (const [h, m] of [[0, 30], [1, 0], [4, 59]]) {
    const r = dzienPlanu(new Date(2026, 10, 3, h, m), PLAN);
    assert.equal(r.dzis.id, 'gora-a', `${h}:${m}`);
    assert.equal(r.data, '2026-11-02');
    assert.equal(r.poPolnocy, true);
  }
  const rano = dzienPlanu(new Date(2026, 10, 3, 5, 0), PLAN);
  assert.equal(rano.dzis.id, 'dol-a');
  assert.equal(rano.data, '2026-11-03');
  const w = dzienPlanu(new Date(2026, 10, 2, 23, 50), PLAN); // pn 23:50
  assert.equal(w.dzis.id, 'gora-a');
  const sr = dzienPlanu(new Date(2026, 10, 4, 18, 0), PLAN); // środa: wolne
  assert.equal(sr.dzis, null);
  assert.equal(sr.nastepny.id, 'gora-b');
  const czw = dzienPlanu(new Date(2026, 10, 6, 0, 30), PLAN); // pt 0:30 = czwartek
  assert.equal(czw.dzis.id, 'gora-b');
});

test('tydzień planu', () => {
  assert.equal(tydzienPlanu('2026-11-02', START_TRENINGU), 1);
  assert.equal(tydzienPlanu('2026-11-08', START_TRENINGU), 1);
  assert.equal(tydzienPlanu('2026-11-09', START_TRENINGU), 2);
  assert.equal(tydzienPlanu('2026-11-16', START_TRENINGU), 3);
  assert.equal(tydzienPlanu('2026-10-30', START_TRENINGU), 0);
});

test('format kg i czasu', () => {
  assert.equal(formatKg(52.5), '52,5');
  assert.equal(formatKg(50), '50');
  assert.equal(formatCzas(95), '1:35');
  assert.equal(formatCzas(3725), '1:02:05');
});

test('serie jako tekst: identyczne scalone, różne osobno', () => {
  assert.equal(serieTekst([{ kg: 25, powt: 10 }, { kg: 25, powt: 10 }, { kg: 25, powt: 10 }], 'powt'), '3x10 · 25 kg');
  assert.equal(serieTekst([{ kg: 15, powt: 8 }, { kg: 17.5, powt: 8 }, { kg: 17.5, powt: 6 }], 'powt'), '8x15 kg, 8x17,5 kg, 6x17,5 kg');
  assert.equal(serieTekst([{ kg: 0, powt: 12 }, { kg: 0, powt: 12 }], 'powt'), '2x12');
  assert.equal(serieTekst([{ kg: 0, powt: 12 }, { kg: 0, powt: 10 }], 'powt'), '12, 10');
  assert.equal(serieTekst([{ kg: 0, powt: 45 }, { kg: 0, powt: 45 }], 's'), '2x45 s');
  assert.equal(serieTekst([{ kg: 50, powt: 12 }], 'powt'), '12x50 kg');
});

test('propozycja: znane wyniki Daniela z 2.11 (Góra A)', () => {
  const t = 1;
  const p = (id) => {
    const c = cwPlanu(id);
    return propozycja({ ost: ostatnio([], id, c.znane), cel: parsujCel(c.cel), startKg: c.startKg, krok: c.krok, tydzien: t });
  };
  // ławka 3x12 przy 50 kg, zakres 6-10: górna granica we wszystkich seriach -> +2,5
  assert.equal(p('wyciskanie-sztangi-na-lawce-poziomej').kg, 52.5);
  // wiosłowanie 3x10 przy 40 (8-12, ok): ten sam ciężar, 11 powt.
  assert.deepEqual([p('wioslowanie-na-wyciagu-siedzac').kg, p('wioslowanie-na-wyciagu-siedzac').powt], [40, 11]);
  // młotki 2x8 przy 12,5 (10-15): poniżej zakresu -> 10 kg
  assert.equal(p('uginanie-ramion-mlotkowe-z-hantlami').kg, 10);
  // nad głowę 2x8 przy 17,5, ciężko (8-12): ten sam ciężar i powtórzenia
  const n = p('wyciskanie-hantli-nad-glowe-siedzac');
  assert.deepEqual([n.kg, n.powt], [17.5, 8]);
  assert.match(n.powod, /ciężko/);
  assert.match(n.powod, /Tydz\. 1: zostaw 3-4 powt\. w zapasie/);
  // bez historii: start z planu
  const s = p('wypychanie-na-suwnicy');
  assert.deepEqual([s.kg, s.start], [60, true]);
  assert.match(s.powod, /^Start, sprawdź na serii rozgrzewkowej/);
});

test('propozycja: krok, bez ciężaru, sekundy, brak danych', () => {
  const cel = parsujCel('3 x 12-20');
  const gora = [{ kg: 5, powt: 20 }, { kg: 5, powt: 20 }, { kg: 5, powt: 21 }];
  assert.equal(propozycja({ ost: { serie: gora }, cel, krok: 1 }).kg, 6);
  assert.equal(propozycja({ ost: { serie: gora.slice(0, 2) }, cel, krok: 1 }).kg, 5); // za mało serii
  const bez = propozycja({ ost: null, cel, startKg: 0 });
  assert.deepEqual([bez.kg, bez.powt, bez.start], [0, 12, true]);
  const deska = propozycja({ ost: { serie: [{ kg: 0, powt: 40 }, { kg: 0, powt: 35 }] }, cel: parsujCel('2 x 30-60 s') });
  assert.equal(deska.powt, 40);
  assert.equal(propozycja({ ost: null, cel }), null);
  assert.equal(propozycja({ ost: { serie: [{ kg: 2.5, powt: 5 }] }, cel, krok: 2.5 }).kg, 0);
});

test('wiersze startowe: z ostatniego razu, a bez historii z propozycji', () => {
  const cel = parsujCel('3 x 6-10');
  const w = wierszeStartowe({ cel, ost: { serie: [{ kg: 50, powt: 12 }, { kg: 52.5, powt: 8 }] } });
  assert.deepEqual(w.map((s) => [s.kg, s.powt]), [[50, 12], [52.5, 8], [52.5, 8]]);
  assert.ok(w.every((s) => !s.z && s.auto));
  const p = wierszeStartowe({ cel, prop: { kg: 60, powt: 8 } });
  assert.deepEqual(p.map((s) => s.kg), [60, 60, 60]);
  assert.deepEqual(wierszeStartowe({ cel: parsujCel('2 x 10') }).map((s) => [s.kg, s.powt]), [[0, 10], [0, 10]]);
});

test('odhaczenie serii: zmieniona seria przechodzi na dalsze nieruszane', () => {
  const serie = wierszeStartowe({ cel: parsujCel('3 x 8-12'), ost: { serie: [{ kg: 15, powt: 8 }] } });
  odhaczSerie(serie, 0, 1);
  assert.deepEqual(serie.map((s) => s.kg), [15, 15, 15]);
  assert.equal(aktywnaSeria(serie), 1);
  Object.assign(serie[1], { kg: 17.5, auto: false });
  serie[2].powt = 6; // ruszana ręcznie, ale dalej auto -> dostanie liczby z serii 2
  odhaczSerie(serie, 1, 2);
  assert.deepEqual(serie.map((s) => s.kg), [15, 17.5, 17.5]);
  serie[2].auto = false;
  serie[2].kg = 20;
  odhaczSerie(serie, 2, 3);
  assert.equal(aktywnaSeria(serie), -1);
});

const trening = {
  dzienId: 'gora-a', dataPlanu: '2026-11-02', start: 0, koniec: 62 * 60000,
  cwiczenia: {
    'wyciskanie-sztangi-na-lawce-poziomej': { serie: [{ kg: 50, powt: 12 }, { kg: 52.5, powt: 10 }, { kg: 52.5, powt: 8 }], ocena: 'ok' },
    'wyciskanie-hantli-nad-glowe-siedzac': { serie: [{ kg: 15, powt: 8 }, { kg: 17.5, powt: 8 }, { kg: 17.5, powt: 6 }], ocena: 'ciezko' },
    'brzuch-spiecia-na-wyciagu': { serie: [{ kg: 25, powt: 10 }, { kg: 25, powt: 10 }, { kg: 25, powt: 10 }], ocena: 'ok' },
  },
  dodatkowe: [{ id: 'x-wioslo', nazwa: 'Wiosło T-bar', cel: '3 x 10', przerwa: '90 s' }],
};
trening.cwiczenia['x-wioslo'] = { serie: [{ kg: 30, powt: 10 }] };

test('podsumowanie dla Trenera: format per ćwiczenie, pominięte na końcu', () => {
  const linie = podsumowanie(trening, PLAN).split('\n');
  assert.equal(linie[0], 'Byłem: Poniedziałek: Góra A + brzuch (02.11.2026), 1 h 02 min');
  assert.equal(linie[1], 'Wyciskanie sztangi na ławce poziomej: 12x50 kg, 10x52,5 kg, 8x52,5 kg · ok');
  assert.equal(linie[2], 'Wyciskanie hantli nad głowę (siedząc): 8x15 kg, 8x17,5 kg, 6x17,5 kg · ciężko');
  assert.equal(linie[3], 'Brzuch: spięcia na wyciągu: 3x10 · 25 kg · ok');
  assert.equal(linie[4], 'Wiosło T-bar: 10x30 kg');
  assert.match(linie[5], /^Pominięte: Wiosłowanie na wyciągu siedząc, /);
});

test('statystyki i rekordy', () => {
  const s = statystyki(trening, PLAN);
  assert.equal(s.serie, 10);
  assert.equal(s.cwiczenia, 4);
  const przed = [{ dataPlanu: '2026-10-30', cwiczenia: { 'wyciskanie-sztangi-na-lawce-poziomej': { serie: [{ kg: 50, powt: 12 }] } } }];
  assert.deepEqual(rekordy(trening, przed, PLAN), [{ nazwa: 'Wyciskanie sztangi na ławce poziomej', kg: 52.5, bylo: 50 }]);
  assert.equal(ostatnio(przed, 'wyciskanie-sztangi-na-lawce-poziomej').data, '2026-10-30');
  assert.equal(ostatnio(przed, 'nic'), null);
  assert.equal(ostatnio([], 'nic', { data: '2026-11-02', serie: [{ kg: 1, powt: 1 }] }).znane, true);
});
