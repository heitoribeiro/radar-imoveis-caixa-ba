#!/usr/bin/env python3
"""Atualiza a lista pública nacional de imóveis da CAIXA para o GitHub Pages.

- Baixa as 27 listas estaduais de forma controlada e com novas tentativas.
- Estrutura tipo, quartos, WC, vagas e áreas.
- Mantém a primeira data de detecção global por imóvel.
- Gera a base nacional apenas para o artefato do Pages, evitando inflar o Git.
"""

from __future__ import annotations

import csv
import io
import json
import re
import sys
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DATA_DIR = ROOT / ".generated-data"
NATIONAL_FILE = PUBLIC_DATA_DIR / "imoveis-brasil.json"
FIRST_SEEN_FILE = ROOT / "data" / "first-seen.json"
SOURCE_PAGE = "https://venda-imoveis.caixa.gov.br/sistema/download-lista.asp"
SOURCE_URL = "https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_{uf}.csv"
BR_TZ = timezone(timedelta(hours=-3))
UFS = [
    "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
    "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
]

def now_br() -> datetime:
    return datetime.now(timezone.utc).astimezone(BR_TZ)

def normalize(value: str | None) -> str:
    value = str(value or "")
    value = unicodedata.normalize("NFD", value)
    value = "".join(c for c in value if unicodedata.category(c) != "Mn")
    value = value.replace("º", "").replace("°", "")
    value = re.sub(r"[^a-zA-Z0-9]+", " ", value)
    return value.strip().lower()

def decode_bytes(raw: bytes, uf: str) -> str:
    for enc in ("cp1252", "latin1", "utf-8"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    raise RuntimeError(f"{uf}: codificação do CSV não reconhecida")

def download_uf(uf: str, retries: int = 5) -> str:
    url = SOURCE_URL.format(uf=uf)
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; RadarImoveisBrasil-GitHubPages/3.1)",
        "Accept": "text/csv,application/octet-stream,*/*",
    }
    last = None
    for attempt in range(1, retries + 1):
        try:
            with urlopen(Request(url, headers=headers), timeout=60) as response:
                raw = response.read()
            if len(raw) < 200:
                raise RuntimeError(f"{uf}: arquivo vazio")
            text = decode_bytes(raw, uf)
            sample = normalize(text[:8000])
            if ";" not in text[:8000] or "cidade" not in sample or "imovel" not in sample:
                raise RuntimeError(f"{uf}: resposta temporária não é o CSV esperado")
            return text
        except (HTTPError, URLError, TimeoutError, RuntimeError) as exc:
            last = exc
            if attempt < retries:
                time.sleep(attempt * 3)
    raise RuntimeError(f"{uf}: falha após {retries} tentativas: {last}")

def generation_date(text: str) -> str | None:
    match = re.search(r"Data\s+de\s+gera(?:ç|c)[aã]o\s*:?\s*;?\s*(\d{2}/\d{2}/\d{4})", text, re.I)
    if not match:
        match = re.search(r"(\d{2}/\d{2}/\d{4})", text)
    if not match:
        return None
    day, month, year = match.group(1).split("/")
    return f"{year}-{month}-{day}"

def parse_decimal(value: str | None) -> float | None:
    text = str(value or "").strip().replace("R$", "").replace("%", "").replace(" ", "")
    text = re.sub(r"[^0-9,.-]", "", text)
    if not text:
        return None
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    elif "," in text:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None

def find_header(lines: list[str]) -> int:
    for idx, line in enumerate(lines[:20]):
        cells = [normalize(cell) for cell in next(csv.reader([line], delimiter=";"))]
        if any("imovel" in cell for cell in cells) and "cidade" in cells:
            return idx
    raise RuntimeError("Cabeçalho da lista não reconhecido")

def col_index(headers: list[str], predicate) -> int:
    for idx, value in enumerate(normalize(h) for h in headers):
        if predicate(value):
            return idx
    return -1

def get(row: list[str], idx: int) -> str:
    return row[idx].strip() if 0 <= idx < len(row) else ""

def absolute_link(value: str, number: str) -> str:
    value = value.strip()
    if value.startswith(("http://", "https://")):
        return value
    if value.startswith("/"):
        return "https://venda-imoveis.caixa.gov.br" + value
    digits = re.sub(r"\D", "", number)
    if digits:
        return f"https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnOrigem=index&hdnimovel={digits}"
    return SOURCE_PAGE

def _first_number(patterns: list[str], text: str) -> int | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            try:
                return int(match.group(1))
            except (ValueError, TypeError):
                pass
    return None

def _area(pattern: str, text: str) -> float | None:
    match = re.search(pattern, text, re.I)
    return parse_decimal(match.group(1)) if match else None

def parse_description(description: str, price: float | None) -> dict:
    text = str(description or "").strip()
    low = normalize(text)
    property_type = ""
    if text:
        first = text.split(",", 1)[0].strip()
        if first and len(first) <= 45 and not re.search(r"\d", first):
            property_type = first
    quartos = _first_number([r"(\d+)\s*qto\(s\)", r"(\d+)\s*quarto(?:s)?", r"(\d+)\s*dormit[oó]rio(?:s)?"], text)
    salas = _first_number([r"(\d+)\s*sala\(s\)", r"(\d+)\s*sala(?:s)?"], text)
    vagas = _first_number([r"(\d+)\s*vaga\(s\)(?:\s+de\s+garagem)?", r"(\d+)\s*vaga(?:s)?\s+de\s+garagem"], text)
    explicit_wc = _first_number([r"(\d+)\s*WC(?:s)?\b", r"(\d+)\s*banheiro(?:s)?", r"(\d+)\s*banh(?:eiro)?(?:s)?"], text)
    if explicit_wc is not None:
        banheiros = explicit_wc
    else:
        wc_count = len(re.findall(r"\bWC\b", text, re.I))
        bathroom_count = len(re.findall(r"\bbanheiro(?:s)?\b", low, re.I))
        banheiros = wc_count + bathroom_count or None
    area_total = _area(r"([\d.,]+)\s+de\s+[aá]rea\s+total", text)
    area_privativa = _area(r"([\d.,]+)\s+de\s+[aá]rea\s+privativa", text)
    area_terreno = _area(r"([\d.,]+)\s+de\s+[aá]rea\s+(?:do\s+)?terreno", text)
    preco_m2 = round(price / area_privativa, 2) if price is not None and area_privativa and area_privativa > 0 else None
    return {
        "tipoImovel": property_type,
        "quartos": quartos,
        "banheiros": banheiros,
        "salas": salas,
        "vagas": vagas,
        "areaTotal": area_total,
        "areaPrivativa": area_privativa,
        "areaTerreno": area_terreno,
        "precoM2": preco_m2,
    }

def parse_properties(text: str, expected_uf: str) -> list[dict]:
    lines = text.splitlines()
    header_idx = find_header(lines)
    reader = csv.reader(io.StringIO("\n".join(lines[header_idx:])), delimiter=";")
    headers = next(reader)
    idx = {
        "number": col_index(headers, lambda h: "imovel" in h and (h.startswith("n ") or "numero" in h or h.startswith("n"))),
        "uf": col_index(headers, lambda h: h == "uf"),
        "city": col_index(headers, lambda h: h == "cidade"),
        "neighborhood": col_index(headers, lambda h: h == "bairro"),
        "address": col_index(headers, lambda h: "endereco" in h),
        "price": col_index(headers, lambda h: h == "preco"),
        "appraisal": col_index(headers, lambda h: "valor" in h and "avaliacao" in h),
        "discount": col_index(headers, lambda h: "desconto" in h),
        "financing": col_index(headers, lambda h: "financiamento" in h),
        "description": col_index(headers, lambda h: "descricao" in h),
        "modality": col_index(headers, lambda h: "modalidade" in h),
        "link": col_index(headers, lambda h: "link" in h),
    }
    if idx["number"] < 0 or idx["city"] < 0 or idx["price"] < 0:
        raise RuntimeError(f"{expected_uf}: estrutura do CSV mudou: {headers}")
    result = []
    seen = set()
    for row in reader:
        number = get(row, idx["number"])
        city = get(row, idx["city"]).upper()
        if not number or not city or number in seen:
            continue
        seen.add(number)
        price = parse_decimal(get(row, idx["price"]))
        description = get(row, idx["description"])
        uf = (get(row, idx["uf"]) or expected_uf).upper()
        prop = {
            "numeroImovel": number,
            "uf": uf,
            "cidade": city,
            "bairro": get(row, idx["neighborhood"]),
            "endereco": get(row, idx["address"]),
            "preco": price,
            "valorAvaliacao": parse_decimal(get(row, idx["appraisal"])),
            "desconto": parse_decimal(get(row, idx["discount"])),
            "financiamento": get(row, idx["financing"]),
            "descricao": description,
            "modalidade": get(row, idx["modality"]),
            "link": absolute_link(get(row, idx["link"]), number),
        }
        prop.update(parse_description(description, price))
        result.append(prop)
    return result

def load_registry() -> dict:
    if not FIRST_SEEN_FILE.exists():
        return {"initialized": False, "scope": None, "baselineCreatedAt": None, "items": {}}
    try:
        data = json.loads(FIRST_SEEN_FILE.read_text(encoding="utf-8"))
        if not isinstance(data.get("items"), dict):
            data["items"] = {}
        return data
    except Exception:
        return {"initialized": False, "scope": None, "baselineCreatedAt": None, "items": {}}

def migrate_registry(registry: dict) -> None:
    items = registry.setdefault("items", {})
    if registry.get("scope") == "BR":
        return
    migrated = {}
    for key, value in items.items():
        migrated[key if ":" in key else f"BA:{key}"] = value
    registry["items"] = migrated

def fetch_all_states() -> tuple[list[dict], list[dict]]:
    properties: list[dict] = []
    states_meta: list[dict] = []
    errors: list[str] = []
    # A CAIXA pode devolver páginas de rejeição quando recebe muitas consultas
    # simultâneas. A coleta sequencial é intencional para priorizar confiabilidade.
    for position, uf in enumerate(UFS):
        try:
            text = download_uf(uf)
            props = parse_properties(text, uf)
            properties.extend(props)
            states_meta.append({"uf": uf, "total": len(props), "generatedAt": generation_date(text)})
            print(f"[{uf}] {len(props)} imóveis")
        except Exception as exc:
            errors.append(f"{uf}: {exc}")
            print(f"[{uf}] ERRO: {exc}", file=sys.stderr)
        if position < len(UFS) - 1:
            time.sleep(0.8)
    if errors:
        raise RuntimeError("Falha em uma ou mais UFs: " + " | ".join(errors))
    states_meta.sort(key=lambda x: x["uf"])
    return properties, states_meta

def main() -> int:
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    FIRST_SEEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    properties, states_meta = fetch_all_states()
    if not properties:
        raise RuntimeError("Nenhum imóvel foi identificado no Brasil.")

    now = now_br()
    now_iso = now.isoformat(timespec="seconds")
    today = now.date().isoformat()
    registry = load_registry()
    migrate_registry(registry)
    items = registry.setdefault("items", {})
    national_initialized = bool(registry.get("initialized")) and registry.get("scope") == "BR" and bool(items)

    new_count = 0
    new_by_state = {uf: 0 for uf in UFS}
    for prop in properties:
        key = f'{prop["uf"]}:{prop["numeroImovel"]}'
        is_new = national_initialized and key not in items
        if key not in items:
            items[key] = today
        prop["firstSeen"] = items[key]
        prop["newOnLatestUpdate"] = is_new
        if is_new:
            new_count += 1
            new_by_state[prop["uf"]] = new_by_state.get(prop["uf"], 0) + 1

    if not national_initialized:
        registry["initialized"] = True
        registry["scope"] = "BR"
        registry["baselineCreatedAt"] = today
        for prop in properties:
            prop["newOnLatestUpdate"] = False
        new_count = 0
        new_by_state = {uf: 0 for uf in UFS}

    registry["lastUpdatedAt"] = now_iso
    registry["currentCount"] = len(properties)
    registry["scope"] = "BR"
    FIRST_SEEN_FILE.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    for state_meta in states_meta:
        state_meta["newCount"] = new_by_state.get(state_meta["uf"], 0)

    properties.sort(key=lambda p: (p.get("firstSeen") or "", p.get("uf") or "", p.get("numeroImovel") or ""), reverse=True)
    payload = {
        "scope": "BR",
        "source": SOURCE_PAGE,
        "fetchedAt": now_iso,
        "updatedAt": today,
        "total": len(properties),
        "newCount": new_count,
        "schemaVersion": 3,
        "states": states_meta,
        "properties": properties,
    }
    NATIONAL_FILE.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Atualização nacional concluída: {len(properties)} imóveis; {new_count} novos.")
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        raise
