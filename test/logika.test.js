import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsujCel, przerwaSekundy, dzienPlanu, formatKg, formatCzas, podpowiedzSerii,
  sugestia, podsumowanie, statystyki, rekordy, ostatnio,
} from '../logika.js';
import { PLAN } from '../plan.js';

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

test('każde ćwiczenie w planie da się sparsować', () => {
  for (const d of PLAN) for (const c of d.cwiczenia) {
    const cel = parsujCel(c.cel);
    assert.ok(cel.serie >= 1 && cel.min >= 1, c.nazwa);
    assert.ok(przerwaSekundy(c.przerwa) >= 30, c.nazwa);
  }
});

test('dzienPlanu: o 1:00 w nocy wtorku liczy się jeszcze poniedziałek', () => {
  const r = dzienPlanu(new Date(2026, 10, 3, 1, 0), PLAN); // wt 3.11, 1:00
  assert.equal(r.dzis.id, 'gora-a');
  assert.equal(r.data, '2026-11-02');
  const w = dzienPlanu(new Date(2026, 10, 3, 18, 0), PLAN); // wt 18:00
  assert.equal(w.dzis.id, 'dol-a');
  const sr = dzienPlanu(new Date(2026, 10, 4, 18, 0), PLAN); // środa: wolne
  assert.equal(sr.dzis, null);
  assert.equal(sr.nastepny.id, 'gora-b');
});

test('format kg i czasu', () => {
  assert.equal(formatKg(52.5), '52,5');
  assert.equal(formatKg(50), '50');
  assert.equal(formatCzas(95), '1:35');
  assert.equal(formatCzas(3725), '1:02:05');
});

test('podpowiedź serii: poprzednia seria dziś, potem ta sama seria ostatnio, potem cel', () => {
  const cel = parsujCel('3 x 6-10');
  assert.deepEqual(podpowiedzSerii({ cel }), { kg: 0, powt: 6 });
  assert.deepEqual(podpowiedzSerii({ cel, kgZapasowe: 50 }), { kg: 50, powt: 6 });
  const ost = [{ kg: 50, powt: 12 }, { kg: 52.5, powt: 8 }];
  assert.deepEqual(podpowiedzSerii({ cel, ostatnieSerie: ost }), { kg: 50, powt: 12 });
  assert.deepEqual(podpowiedzSerii({ cel, ostatnieSerie: ost, dzis: [{ kg: 15, powt: 10 }] }), { kg: 15, powt: 10 });
});

test('sugestia progresji', () => {
  const cel = parsujCel('3 x 6-10');
  assert.match(sugestia([{ kg: 50, powt: 12 }, { kg: 50, powt: 10 }, { kg: 50, powt: 10 }], cel), /52,5 kg/);
  assert.match(sugestia([{ kg: 50, powt: 8 }], cel), /Cel: 50 kg/);
  assert.equal(sugestia([], cel), '');
});

const trening = {
  dzienId: 'gora-a', dataPlanu: '2026-11-02', start: 0, koniec: 62 * 60000,
  cwiczenia: {
    'wyciskanie-sztangi-na-lawce-poziomej': { serie: [{ kg: 50, powt: 12 }, { kg: 52.5, powt: 10 }, { kg: 52.5, powt: 8 }], ocena: 'ok' },
    'unoszenie-hantli-bokiem': { serie: [{ kg: 15, powt: 10 }, { kg: 20, powt: 8 }], ocena: '' },
  },
  dodatkowe: [{ id: 'x-wioslo', nazwa: 'Wiosło T-bar', cel: '3 x 10', przerwa: '90 s' }],
};
trening.cwiczenia['x-wioslo'] = { serie: [{ kg: 30, powt: 10 }] };

test('podsumowanie dla Trenera: każda seria osobno, pominięte na końcu', () => {
  const t = podsumowanie(trening, PLAN);
  const linie = t.split('\n');
  assert.equal(linie[0], 'Byłem: Góra A + brzuch (02.11.2026), 1 h 02 min');
  assert.equal(linie[1], '- Wyciskanie sztangi na ławce poziomej: 50×12, 52,5×10, 52,5×8 · ok');
  assert.equal(linie[2], '- Unoszenie hantli bokiem: 15×10, 20×8');
  assert.equal(linie[3], '- Wiosło T-bar: 30×10');
  assert.match(linie[4], /^Pominięte: Wiosłowanie na wyciągu siedząc, /);
});

test('statystyki i rekordy', () => {
  const s = statystyki(trening, PLAN);
  assert.equal(s.serie, 6);
  assert.equal(s.cwiczenia, 3);
  assert.equal(s.objetosc, 50 * 12 + 52.5 * 10 + 52.5 * 8 + 150 + 160 + 300);
  const przed = [{ dataPlanu: '2026-10-30', cwiczenia: { 'wyciskanie-sztangi-na-lawce-poziomej': { serie: [{ kg: 50, powt: 12 }] } } }];
  assert.deepEqual(rekordy(trening, przed, PLAN), [{ nazwa: 'Wyciskanie sztangi na ławce poziomej', kg: 52.5, bylo: 50 }]);
  assert.equal(ostatnio(przed, 'wyciskanie-sztangi-na-lawce-poziomej').data, '2026-10-30');
  assert.equal(ostatnio(przed, 'nic'), null);
});
