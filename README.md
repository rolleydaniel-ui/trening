# Trening

Apka na telefon do planu treningowego Daniela: https://rolleydaniel-ui.github.io/trening/

- **Start** na dzisiejszy dzień planu (do 5:00 rano liczy się jeszcze poprzedni dzień, bo trening bywa o 1:00 w nocy).
- Ćwiczenia w dowolnej kolejności. Każda seria to osobny wiersz (kg, powtórzenia albo sekundy, ✓): duże +/− i wpisywanie z klawiatury, „+ Seria”, „jak seria N”, odhaczanie i odznaczanie. Wiersze startują z tym, co było ostatnio (a bez historii z propozycji startowej). Zmieniona seria przechodzi na dalsze, jeszcze nieruszane.
- **Propozycja ciężaru** przy każdym ćwiczeniu (tapnięcie wstawia do nieodhaczonych serii): górna granica zakresu we wszystkich seriach = + krok, poniżej dolnej = − krok, w zakresie = ten sam ciężar i +1 powtórzenie (po „ciężko” te same powtórzenia). Bez historii: ciężar startowy z planu Trenera, oznaczony „start”.
- Po odhaczeniu serii sama rusza **przerwa** (czas z planu, można wyłączyć w Opcjach), dźwięk i wibracja na koniec, ±15 s, pomiń. Pasek przerwy jest przyklejony nad dolnym przyciskiem, ekran nie skacze. Ekran nie gaśnie w trakcie treningu.
- Na koniec podsumowanie, rekordy i tekst do wklejenia Trenerowi, np. `Brzuch: spięcia na wyciągu: 3x10 · 25 kg · ok` albo `Wyciskanie hantli nad głowę (siedząc): 8x15 kg, 8x17,5 kg, 6x17,5 kg · ciężko`. Kopiowanie: schowek, a jak telefon nie pozwala, tekst zostaje zaznaczony do ręcznego skopiowania.
- Dane są tylko w przeglądarce telefonu (localStorage). W Opcjach jest kopia zapasowa do pliku.
- Działa też bez internetu (service worker: najpierw sieć, potem ostatnia zapisana wersja).

## Pliki

- `index.html`, `style.css`, `app.js`: apka (bez budowania, zwykły JS w module).
- `logika.js`: liczenie bez DOM (cel serii, przerwy, podpowiedzi, podsumowanie). Testy: `npm test`.
- `plan.js`: plan wygenerowany z planu Trenera (`dane.py`: `DNI`, a dla apki `APKA` z `start_kg`/`krok`/`hantle`, `ZNANE_WYNIKI`, `START_TRENINGU`). Po zmianie planu: `py narzedzia/eksport_planu.py`.
- `img/`: ilustracje z [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense).
- `narzedzia/serwer.mjs`: podgląd lokalny (`node narzedzia/serwer.mjs`, http://localhost:8123).
- `narzedzia/zrzuty.mjs`: przeklikanie treningu w Chrome bez okna (dotyk), zrzuty ekranu i ok. 30 sprawdzeń: zapis per seria, przewijanie, kopiowanie, trening o 0:30, cele dotykowe ≥ 44 px.
