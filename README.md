# Trening

Apka na telefon do planu treningowego Daniela: https://rolleydaniel-ui.github.io/trening/

- **Start** na dzisiejszy dzień planu (do 5:00 rano liczy się jeszcze poprzedni dzień, bo trening bywa o 1:00 w nocy).
- **Propozycje ciężaru na każdy dzień**: na starcie (każdy dzień planu, przesuń palcem w bok albo tapnij dzień) i na liście w treningu przy każdym ćwiczeniu jest „Dziś: 52,5 kg × 6 · 3 serie” (bez historii „Start: …” z ciężarem startowym Trenera). Reguły: górna granica zakresu we wszystkich seriach = + krok, poniżej dolnej = − krok, w zakresie = ten sam ciężar i +1 powtórzenie (po „ciężko” te same powtórzenia).
- Ćwiczenia w dowolnej kolejności. Na ekranie ćwiczenia duża ilustracja (dwie klatki na zmianę, tapnięcie zmniejsza/powiększa), **przesunięcie palcem w bok** albo strzałki ‹ › = poprzednie/następne ćwiczenie.
- Każda seria to osobny wiersz (kg × powtórzenia albo sekundy, ✓). Wiersze startują z propozycji na dziś. Aktywna seria ma **suwaki** kg i powtórzeń: przesuwasz palcem albo tapiesz liczbę, do tego −/+ i „wpisz ręcznie”. Tapnięcie w inny wiersz (także odhaczony) przenosi do niego suwaki. Zmieniona seria przechodzi na dalsze, jeszcze nieruszane. „+ Seria”, „− Seria”, odhaczanie i odznaczanie.
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
- `narzedzia/zrzuty.mjs`: przeklikanie treningu w Chrome bez okna (dotyk), zrzuty ekranu i ok. 50 sprawdzeń: propozycje na każdy dzień, suwaki, przesuwanie palcem, zapis per seria, przewijanie, kopiowanie, trening o 0:30, cele dotykowe ≥ 44 px.
