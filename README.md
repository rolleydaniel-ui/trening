# Trening

Apka na telefon do planu treningowego Daniela: https://rolleydaniel-ui.github.io/trening/

- **Start** na dzisiejszy dzień planu (do 5:00 rano liczy się jeszcze poprzedni dzień, bo trening bywa o 1:00 w nocy).
- Ćwiczenia w dowolnej kolejności. Każda seria osobno: kg i powtórzenia (albo sekundy), podpowiedź z poprzedniej serii i z ostatniego razu.
- Po każdej serii sama rusza **przerwa** (czas z planu), z dźwiękiem i wibracją na koniec, ±15 s, pomiń. Ekran nie gaśnie w trakcie treningu.
- Na koniec podsumowanie, rekordy i tekst do wklejenia Trenerowi na Discordzie.
- Dane są tylko w przeglądarce telefonu (localStorage). W Opcjach jest kopia zapasowa do pliku.
- Działa też bez internetu (service worker: najpierw sieć, potem ostatnia zapisana wersja).

## Pliki

- `index.html`, `style.css`, `app.js`: apka (bez budowania, zwykły JS w module).
- `logika.js`: liczenie bez DOM (cel serii, przerwy, podpowiedzi, podsumowanie). Testy: `npm test`.
- `plan.js`: plan wygenerowany z planu Trenera. Po zmianie planu: `py narzedzia/eksport_planu.py`.
- `img/`: ilustracje z [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense).
- `narzedzia/serwer.mjs`: podgląd lokalny (`node narzedzia/serwer.mjs`, http://localhost:8123).
- `narzedzia/zrzuty.mjs`: przeklikanie całego treningu w Chrome bez okna i zrzuty ekranu.
