"""Eksport planu Trenera do plan.js (dane dla apki).

Czyta dane.py z folderu Trenera (tylko odczyt) i zapisuje plan.js obok index.html.
Uruchom po każdej zmianie planu:  py narzedzia/eksport_planu.py
Zdjęcia muszą już być w img/ (pobiera je build_app.py Trenera).
"""
import json, os, re, sys, urllib.parse

TU = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(TU)
TRENER = os.environ.get("TRENER_PLAN", os.path.expanduser("~/sztab/dane/agenci/trener/plan-ze-zdjeciami"))
sys.path.insert(0, TRENER)
import dane  # noqa: E402

DNI, db = dane.DNI, dane.db
APKA = getattr(dane, "APKA", {})
ZNANE = getattr(dane, "ZNANE_WYNIKI", {})
START_TRENINGU = getattr(dane, "START_TRENINGU", "")
NAZWY = {c[0] for _, _, cw in DNI for c in cw}
for k in list(APKA) + list(ZNANE):
    if k not in NAZWY:
        raise SystemExit("dane.py: nie ma takiego ćwiczenia w DNI: " + k)

# Który dzień tygodnia (0 = niedziela, jak getDay() w JS) to który dzień planu.
DZIEN_TYGODNIA = [1, 2, 4, 5]
KROTKO = ["Pn", "Wt", "Czw", "Pt"]


def zdjecia(klucz):
    e = db[klucz]
    out = []
    for p in e["images"][:2]:
        fn = p.replace("/", "_").replace(" ", "_")
        if not os.path.exists(os.path.join(REPO, "img", fn)):
            raise SystemExit("Brak zdjęcia img/" + fn + " (uruchom build_app.py Trenera)")
        out.append("img/" + fn)
    return out * 2 if len(out) == 1 else out


def yt(q):
    return "https://www.youtube.com/results?search_query=" + urllib.parse.quote(q)


def slug(s):
    s = s.lower()
    for a, b in zip("ąćęłńóśźż", "acelnoszz"):
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


# Ta sama nazwa w dwóch dniach (np. uginanie nóg siedząc i leżąc): id z dopiskiem z bazy zdjęć.
_ile = {}
for _, _, cw in DNI:
    for c in cw:
        _ile[slug(c[0])] = _ile.get(slug(c[0]), 0) + 1


def cwiczenie(pl, serie, przerwa, rada, klucz, uwaga="", fraza=""):
    i = slug(pl) if _ile[slug(pl)] == 1 else slug(pl) + "-" + slug(klucz)
    out = dict(id=i, nazwa=pl, cel=serie, przerwa=przerwa, rada=rada, uwaga=uwaga,
               zdjecia=zdjecia(klucz), yt=yt(fraza or pl + " technika"))
    a = APKA.get(pl, {})
    if "start_kg" in a:
        out["startKg"] = a["start_kg"]
    out["krok"] = a.get("krok", 2.5)
    if a.get("hantle"):
        out["hantle"] = True
    if a.get("uwaga"):
        out["startUwaga"] = a["uwaga"]
    if pl in ZNANE:
        data, n, powt, kg, ocena = ZNANE[pl]
        out["znane"] = dict(data=data, serie=[dict(kg=kg, powt=powt)] * n, ocena=ocena)
    return out


def rozgrzewka(nazwa, ile, rada, klucz=None, fraza=""):
    return dict(nazwa=nazwa, ile=ile, rada=rada, zdjecia=zdjecia(klucz) if klucz else [], yt=yt(fraza) if fraza else "")


GARB = [
    rozgrzewka("Kot-krowa (górne plecy)", "1-2 min", "Na czworakach wyginaj i zaokrąglaj plecy, powoli, z oddechem.", "Cat Stretch", "kot krowa mobilizacja pleców"),
    rozgrzewka("Band pull-apart", "2 x 12-15", "Guma na wysokości klatki, ręce proste, rozciągnij na boki ściągając łopatki.", "Band Pull Apart", "band pull apart technika"),
    rozgrzewka("Rozciąganie klatki przy framudze", "2 x 20-30 s", "Przedramię o framugę na wysokości barku, krok do przodu.", "Dynamic Chest Stretch", "rozciąganie klatki przy framudze"),
]

dni = []
for i, (tytul, opis_rozgrzewki, cw) in enumerate(DNI):
    gora = i in (0, 2)
    pierwsze = cw[0][0]
    rozg = ([rozgrzewka("Marsz albo rower", "5-8 min", "Spokojnie, ma być ciepło, nie zmęczenie.", "Walking, Treadmill", "rozgrzewka przed treningiem siłowym")] + GARB) if gora else \
        [rozgrzewka("Rower albo marsz", "5-8 min", "Spokojnie, ma być ciepło, nie zmęczenie.", "Bicycling, Stationary", "rozgrzewka rowerek stacjonarny")]
    rozg.append(rozgrzewka("Serie rozgrzewkowe: " + pierwsze, "2 serie", "Ok. 50% i 70% ciężaru roboczego, 8 i 4-5 powtórzeń. Potem serie robocze."))
    dni.append(dict(
        id=["gora-a", "dol-a", "gora-b", "dol-b"][i],
        krotko=KROTKO[i],
        dzienTygodnia=DZIEN_TYGODNIA[i],
        nazwa=tytul.split(": ", 1)[1],
        dzien=tytul.split(":")[0],
        rozgrzewka=rozg,
        cwiczenia=[cwiczenie(*c) for c in cw],
        naKoniec=("Marsz na bieżni pod górkę, 15-25 min, tak żebyś mógł rozmawiać." if gora else ""),
    ))

plik = os.path.join(REPO, "plan.js")
with open(plik, "w", encoding="utf-8", newline="\n") as f:
    f.write("// Wygenerowane przez narzedzia/eksport_planu.py z planu Trenera. Nie edytuj ręcznie.\n")
    f.write("export const PLAN = " + json.dumps(dni, ensure_ascii=False, indent=1) + ";\n")
    f.write("export const START_TRENINGU = " + json.dumps(START_TRENINGU) + ";\n")
print("plan.js:", len(dni), "dni,", sum(len(d["cwiczenia"]) for d in dni), "ćwiczeń")
