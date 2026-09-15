#!/usr/bin/env python3
"""Atualiza a lista pública de imóveis CAIXA/BA para o GitHub Pages.

Sem dependências externas: usa apenas a biblioteca padrão do Python.
Mantém a primeira data em que cada número de imóvel foi observado para
permitir ordenação por inclusão detectada e destaque dos novos imóveis.
"""

from __future__ import annotations

import csv
import io
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "imoveis-ba.json"
FIRST_SEEN_FILE = ROOT / "data" / "first-seen.json"
SOURCE_URL = "https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_BA.csv"
SOURCE_PAGE = "https://venda-imoveis.caixa.gov.br/sistema/download-lista.asp"
BAHIA_TZ = timezone(timedelta(hours=-3))


def now_bahia() -> datetime:
    return datetime.now(timezone.utc).astimezone(BAHIA_TZ)


def normalize(value: str | None) -> str:
    value = str(value or "")
    value = unicodedata.normalize("NFD", value)
    value = "".join(c for c in value if unicodedata.category(c) != "Mn")
    value = value.replace("º", "").replace("°", "")
    value = re.sub(r"[^a-zA-Z0-9]+", " ", value)
    return value.strip().lower()


def download() -> str:
    req = Request(
        SOURCE_URL,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; RadarImoveisBA-GitHubPages/1.0)",
            "Accept": "text/csv,application/octet-stream,*/*",
        },
    )
    with urlopen(req, timeout=60) as response:
        raw = response.read()
    if len(raw) < 200:
        raise RuntimeError("A lista recebida da CAIXA está vazia.")
    for encoding in ("cp1252", "latin1", "utf-8"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            pass
    raise RuntimeError("Não foi possível identificar a codificação do CSV.")


def generation_date(text: str) -> str | None:
    match = re.search(r"Data\s+de\s+gera(?:ç|c)[aã]o\s*:?\s*;?\s*(\d{2}/\d{2}/\d{4})", text, re.I)
    if not match:
        match = re.search(r"(\d{2}/\d{2}/\d{4})", text)
    if not match:
        return None
    day, month, year = match.group(1).split("/")
    return f"{year}-{month}-{day}"


def parse_money(value: str | None) -> float | None:
    text = str(value or "").strip().replace("R$", "").replace(" ", "")
    text = re.sub(r"[^0-9,.-]", "", text)
    if not text:
        return None
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def find_header(lines: list[str]) -> int:
    for idx, line in enumerate(lines[:20]):
        cells = [normalize(cell) for cell in next(csv.reader([line], delimiter=";"))]
        if any("imovel" in cell for cell in cells) and "cidade" in cells:
            return idx
    raise RuntimeError("Cabeçalho da lista da CAIXA não foi reconhecido.")


def col_index(headers: list[str], predicate) -> int:
    normalized = [normalize(h) for h in headers]
    for idx, value in enumerate(normalized):
        if predicate(value):
            return idx
    return -1


def get(row: list[str], idx: int) -> str:
    return row[idx].strip() if 0 <= idx < len(row) else ""


def absolute_link(value: str, number: str) -> str:
    value = value.strip()
    if value.startswith("http://") or value.startswith("https://"):
        return value
    if value.startswith("/"):
        return "https://venda-imoveis.caixa.gov.br" + value
    digits = re.sub(r"\D", "", number)
    if digits:
        return f"https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnOrigem=index&hdnimovel={digits}"
    return SOURCE_PAGE


def parse_properties(text: str) -> list[dict]:
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
        raise RuntimeError(f"A estrutura do CSV mudou. Cabeçalhos: {headers}")

    result = []
    seen = set()
    for row in reader:
        number = get(row, idx["number"])
        city = get(row, idx["city"]).upper()
        if not number or not city or number in seen:
            continue
        seen.add(number)
        discount = parse_money(get(row, idx["discount"]).replace("%", ""))
        result.append({
            "numeroImovel": number,
            "uf": get(row, idx["uf"]) or "BA",
            "cidade": city,
            "bairro": get(row, idx["neighborhood"]),
            "endereco": get(row, idx["address"]),
            "preco": parse_money(get(row, idx["price"])),
            "valorAvaliacao": parse_money(get(row, idx["appraisal"])),
            "desconto": discount,
            "financiamento": get(row, idx["financing"]),
            "descricao": get(row, idx["description"]),
            "modalidade": get(row, idx["modality"]),
            "link": absolute_link(get(row, idx["link"]), number),
        })
    return result


def load_registry() -> dict:
    if not FIRST_SEEN_FILE.exists():
        return {"initialized": False, "baselineCreatedAt": None, "items": {}}
    try:
        data = json.loads(FIRST_SEEN_FILE.read_text(encoding="utf-8"))
        if not isinstance(data.get("items"), dict):
            data["items"] = {}
        return data
    except Exception:
        return {"initialized": False, "baselineCreatedAt": None, "items": {}}


def main() -> int:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    text = download()
    properties = parse_properties(text)
    if not properties:
        raise RuntimeError("Nenhum imóvel foi identificado na lista da Bahia.")

    now = now_bahia()
    now_iso = now.isoformat(timespec="seconds")
    today = now.date().isoformat()
    registry = load_registry()
    items = registry.setdefault("items", {})
    initialized = bool(registry.get("initialized")) and bool(items)

    new_count = 0
    current_ids = set()
    for prop in properties:
        number = prop["numeroImovel"]
        current_ids.add(number)
        is_new = initialized and number not in items
        if number not in items:
            items[number] = today
        prop["firstSeen"] = items[number]
        prop["newOnLatestUpdate"] = is_new
        if is_new:
            new_count += 1

    # Na primeira execução, a lista atual vira a linha de base e não é marcada como nova.
    if not initialized:
        registry["initialized"] = True
        registry["baselineCreatedAt"] = today
        for prop in properties:
            prop["newOnLatestUpdate"] = False
        new_count = 0

    registry["lastUpdatedAt"] = now_iso
    registry["currentCount"] = len(properties)
    FIRST_SEEN_FILE.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Mais recentes primeiro já no arquivo, embora o front-end também possa reordenar.
    properties.sort(key=lambda p: (p.get("firstSeen") or "", p.get("numeroImovel") or ""), reverse=True)
    payload = {
        "state": "BA",
        "source": SOURCE_PAGE,
        "csvSource": SOURCE_URL,
        "generatedAt": generation_date(text),
        "fetchedAt": now_iso,
        "updatedAt": today,
        "total": len(properties),
        "newCount": new_count,
        "properties": properties,
    }
    DATA_FILE.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Atualização concluída: {len(properties)} imóveis; {new_count} novos.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        raise
