#!/usr/bin/env python3
"""Envia e-mail com novos imóveis que atendam aos critérios configurados.

Credenciais são lidas exclusivamente de variáveis de ambiente/Secrets:
  SMTP_USER, SMTP_APP_PASSWORD, ALERT_EMAIL_TO
Opcionalmente: SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465)
"""

from __future__ import annotations

import html
import json
import os
import smtplib
import sys
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "imoveis-ba.json"
CONFIG_FILE = ROOT / "config" / "email-alerts.json"


def load_json(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback


def norm(value) -> str:
    return str(value or "").strip().upper()


def matches(prop: dict, rule: dict) -> bool:
    cities = {norm(x) for x in rule.get("cities", []) if x}
    neighborhoods = {norm(x) for x in rule.get("neighborhoods", []) if x}
    types = {norm(x) for x in rule.get("types", []) if x}
    modalities = {norm(x) for x in rule.get("modalities", []) if x}
    if cities and norm(prop.get("cidade")) not in cities: return False
    if neighborhoods and norm(prop.get("bairro")) not in neighborhoods: return False
    if types and norm(prop.get("tipoImovel")) not in types: return False
    if modalities and norm(prop.get("modalidade")) not in modalities: return False
    financing = norm(rule.get("financing"))
    if financing and financing not in {"QUALQUER", "ANY", "TODOS"} and financing not in norm(prop.get("financiamento")): return False
    numeric_filters = [
        ("minBedrooms", "quartos", lambda a,l: a >= l), ("minBathrooms", "banheiros", lambda a,l: a >= l),
        ("minParking", "vagas", lambda a,l: a >= l), ("minPrivateArea", "areaPrivativa", lambda a,l: a >= l),
        ("minPrice", "preco", lambda a,l: a >= l), ("maxPrice", "preco", lambda a,l: a <= l),
        ("minDiscount", "desconto", lambda a,l: a >= l),
    ]
    for config_key, prop_key, check in numeric_filters:
        limit = rule.get(config_key)
        if limit in (None, "", 0): continue
        actual = prop.get(prop_key)
        if not isinstance(actual, (int, float)) or not check(actual, float(limit)): return False
    return True


def money(value) -> str:
    if not isinstance(value, (int, float)): return "Sob consulta"
    text = f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {text}"


def criteria_text(rule: dict) -> str:
    parts = []
    if rule.get("cities"): parts.append("Cidades: " + ", ".join(rule["cities"]))
    if rule.get("neighborhoods"): parts.append("Bairros: " + ", ".join(rule["neighborhoods"]))
    if rule.get("types"): parts.append("Tipos: " + ", ".join(rule["types"]))
    if rule.get("minBedrooms"): parts.append(f"Quartos: {rule['minBedrooms']}+")
    if rule.get("maxPrice"): parts.append(f"Até {money(rule['maxPrice'])}")
    if rule.get("minDiscount"): parts.append(f"Desconto: {rule['minDiscount']}%+")
    return " • ".join(parts) if parts else "Todos os novos imóveis da Bahia"


def build_email(matches_by_rule, payload: dict) -> EmailMessage:
    total = sum(len(items) for _, items in matches_by_rule)
    updated = payload.get("updatedAt") or "hoje"
    subject = f"Radar CAIXA BA: {total} novo{'s' if total != 1 else ''} imóvel{'is' if total != 1 else ''} compatível{'is' if total != 1 else ''}"
    text_lines = [f"Radar de Imóveis CAIXA - Bahia ({updated})", f"Foram encontrados {total} novos imóveis que atendem aos seus critérios.", ""]
    html_blocks = ["<h2 style='margin:0 0 8px'>Radar de Imóveis CAIXA - Bahia</h2>", f"<p>Foram encontrados <strong>{total}</strong> novos imóveis que atendem aos critérios monitorados.</p>"]
    for rule, items in matches_by_rule:
        name = rule.get("name") or "Alerta"; criteria = criteria_text(rule)
        text_lines += [f"{name} — {criteria}", ""]
        html_blocks.append(f"<h3 style='margin:24px 0 4px'>{html.escape(name)}</h3><p style='color:#667085;margin:0 0 12px'>{html.escape(criteria)}</p>")
        for p in items[:25]:
            bedrooms = f" • {p['quartos']} qto(s)" if p.get("quartos") is not None else ""
            area = f" • {p['areaPrivativa']:.0f} m² priv." if isinstance(p.get("areaPrivativa"), (int, float)) else ""
            discount = f" • {p['desconto']:.2f}% desconto" if isinstance(p.get("desconto"), (int, float)) else ""
            label = f"{p.get('tipoImovel') or 'Imóvel'} — {p.get('bairro') or 'Bairro não informado'}, {p.get('cidade') or 'BA'}"
            text_lines += [label, f"{money(p.get('preco'))}{bedrooms}{area}{discount}", p.get("endereco") or "", p.get("link") or "", ""]
            html_blocks.append("<div style='border:1px solid #dbe5ee;border-radius:12px;padding:14px;margin:10px 0'>" f"<strong>{html.escape(label)}</strong><br>" f"<span style='font-size:18px;color:#075985;font-weight:700'>{html.escape(money(p.get('preco')))}</span>" f"<span style='color:#667085'>{html.escape(bedrooms + area + discount)}</span><br>" f"<span style='color:#667085'>{html.escape(p.get('endereco') or '')}</span><br>" f"<a href='{html.escape(p.get('link') or '')}'>Ver imóvel na CAIXA</a></div>")
        if len(items) > 25:
            text_lines.append(f"... e mais {len(items)-25} imóveis neste alerta.\n")
            html_blocks.append(f"<p>... e mais {len(items)-25} imóveis neste alerta.</p>")
    html_blocks.append("<p style='font-size:12px;color:#667085;margin-top:28px'>Fonte: lista pública de imóveis da CAIXA. Confirme disponibilidade e condições no canal oficial antes de qualquer decisão.</p>")
    msg = EmailMessage(); msg["Subject"] = subject; msg.set_content("\n".join(text_lines)); msg.add_alternative("<div style='font-family:Arial,sans-serif;color:#172235;max-width:760px'>" + "".join(html_blocks) + "</div>", subtype="html"); return msg


def main() -> int:
    user = os.getenv("SMTP_USER", "").strip(); password = os.getenv("SMTP_APP_PASSWORD", "").strip(); recipients = [x.strip() for x in os.getenv("ALERT_EMAIL_TO", "").split(",") if x.strip()]
    if not user or not password or not recipients:
        print("Alertas por e-mail ignorados: Secrets SMTP_USER, SMTP_APP_PASSWORD e ALERT_EMAIL_TO não configurados."); return 0
    payload = load_json(DATA_FILE, {}); properties = [p for p in payload.get("properties", []) if p.get("newOnLatestUpdate")]
    if not properties: print("Nenhum imóvel novo nesta atualização; nenhum e-mail enviado."); return 0
    config = load_json(CONFIG_FILE, {"enabled": True, "alerts": [{"name": "Bahia", "cities": []}]})
    if not config.get("enabled", True): print("Alertas por e-mail desativados em config/email-alerts.json."); return 0
    matches_by_rule = []
    for rule in config.get("alerts", []):
        if rule.get("enabled", True) is False: continue
        items = [p for p in properties if matches(p, rule)]
        if items:
            items.sort(key=lambda p: (p.get("desconto") or 0, -(p.get("preco") or 10**15)), reverse=True); matches_by_rule.append((rule, items))
    if not matches_by_rule: print("Existem imóveis novos, mas nenhum atende aos critérios de e-mail."); return 0
    msg = build_email(matches_by_rule, payload); msg["From"] = user; msg["To"] = ", ".join(recipients)
    host = os.getenv("SMTP_HOST", "smtp.gmail.com").strip() or "smtp.gmail.com"; port = int(os.getenv("SMTP_PORT", "465"))
    with smtplib.SMTP_SSL(host, port, timeout=45) as smtp: smtp.login(user, password); smtp.send_message(msg)
    print(f"E-mail enviado para {len(recipients)} destinatário(s)."); return 0


if __name__ == "__main__":
    try: raise SystemExit(main())
    except Exception as exc: print(f"ERRO AO ENVIAR E-MAIL: {exc}", file=sys.stderr); raise
