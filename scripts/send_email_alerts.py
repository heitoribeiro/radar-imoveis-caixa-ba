#!/usr/bin/env python3
"""Envia e-mail apenas quando surgirem imóveis novos que atendam aos alertas.

Credenciais são lidas exclusivamente de GitHub Secrets/variáveis de ambiente:
  SMTP_USER
  SMTP_APP_PASSWORD (preferencial) ou SMTP_PASSWORD
  ALERT_EMAIL_TO     (um ou mais destinatários separados por vírgula)
Opcionalmente: SMTP_HOST (smtp.gmail.com), SMTP_PORT (465), SMTP_FROM.
"""

from __future__ import annotations

import html
import json
import os
import smtplib
import ssl
import sys
import unicodedata
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "imoveis-ba.json"
CONFIG_FILE = ROOT / "config" / "email-alerts.json"


def load_json(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


def norm(value) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return text.strip().upper()


def financing_matches(actual, wanted) -> bool:
    wanted_n = norm(wanted)
    if wanted_n in {"", "QUALQUER", "ANY", "TODOS"}:
        return True
    actual_n = norm(actual)
    if wanted_n in {"SIM", "YES"}:
        return any(token in actual_n for token in ("SIM", "ACEIT", "PERMIT"))
    if wanted_n in {"NAO", "NO"}:
        return "NAO" in actual_n
    return wanted_n in actual_n


def matches(prop: dict, rule: dict) -> bool:
    exact_filters = [
        ("cities", "cidade"),
        ("neighborhoods", "bairro"),
        ("types", "tipoImovel"),
        ("modalities", "modalidade"),
    ]
    for config_key, prop_key in exact_filters:
        accepted = {norm(x) for x in rule.get(config_key, []) if x}
        if accepted and norm(prop.get(prop_key)) not in accepted:
            return False

    if not financing_matches(prop.get("financiamento"), rule.get("financing")):
        return False

    numeric_filters = [
        ("minBedrooms", "quartos", lambda actual, limit: actual >= limit),
        ("minBathrooms", "banheiros", lambda actual, limit: actual >= limit),
        ("minParking", "vagas", lambda actual, limit: actual >= limit),
        ("minPrivateArea", "areaPrivativa", lambda actual, limit: actual >= limit),
        ("minPrice", "preco", lambda actual, limit: actual >= limit),
        ("maxPrice", "preco", lambda actual, limit: actual <= limit),
        ("minDiscount", "desconto", lambda actual, limit: actual >= limit),
    ]
    for config_key, prop_key, check in numeric_filters:
        limit = rule.get(config_key)
        if limit in (None, "", 0, 0.0):
            continue
        actual = prop.get(prop_key)
        if not isinstance(actual, (int, float)) or not check(actual, float(limit)):
            return False
    return True


def money(value) -> str:
    if not isinstance(value, (int, float)):
        return "Sob consulta"
    text = f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {text}"


def criteria_text(rule: dict) -> str:
    parts: list[str] = []
    if rule.get("cities"):
        parts.append("Cidades: " + ", ".join(rule["cities"]))
    if rule.get("neighborhoods"):
        parts.append("Bairros: " + ", ".join(rule["neighborhoods"]))
    if rule.get("types"):
        parts.append("Tipos: " + ", ".join(rule["types"]))
    if rule.get("minBedrooms"):
        parts.append(f"Quartos: {rule['minBedrooms']}+")
    if rule.get("minBathrooms"):
        parts.append(f"WC: {rule['minBathrooms']}+")
    if rule.get("minParking"):
        parts.append(f"Vagas: {rule['minParking']}+")
    if rule.get("maxPrice"):
        parts.append(f"Até {money(rule['maxPrice'])}")
    if rule.get("minDiscount"):
        parts.append(f"Desconto: {rule['minDiscount']}%+")
    financing = norm(rule.get("financing"))
    if financing not in {"", "QUALQUER", "ANY", "TODOS"}:
        parts.append(f"Financiamento: {rule.get('financing')}")
    return " • ".join(parts) if parts else "Todos os novos imóveis da Bahia"


def build_email(matches_by_rule: list[tuple[dict, list[dict]]], payload: dict) -> EmailMessage:
    # Um mesmo imóvel pode atender a mais de um perfil. O total do assunto é único.
    unique_ids = {
        p.get("numeroImovel")
        for _, items in matches_by_rule
        for p in items
        if p.get("numeroImovel")
    }
    total = len(unique_ids)
    updated = payload.get("updatedAt") or "hoje"
    noun = "novo imóvel compatível" if total == 1 else "novos imóveis compatíveis"

    msg = EmailMessage()
    msg["Subject"] = f"Radar CAIXA BA: {total} {noun}"

    text_lines = [
        f"Radar de Imóveis CAIXA - Bahia ({updated})",
        f"Foram encontrados {total} {noun} com os critérios monitorados.",
        "",
    ]
    html_blocks = [
        "<h2 style='margin:0 0 8px'>Radar de Imóveis CAIXA - Bahia</h2>",
        f"<p>Foram encontrados <strong>{total}</strong> {html.escape(noun)} com os critérios monitorados.</p>",
    ]

    for rule, items in matches_by_rule:
        name = str(rule.get("name") or "Alerta")
        criteria = criteria_text(rule)
        text_lines += [f"{name} — {criteria}", ""]
        html_blocks.append(
            f"<h3 style='margin:24px 0 4px'>{html.escape(name)}</h3>"
            f"<p style='color:#667085;margin:0 0 12px'>{html.escape(criteria)}</p>"
        )

        for prop in items[:25]:
            bedrooms = f" • {prop['quartos']} qto(s)" if prop.get("quartos") is not None else ""
            area = (
                f" • {prop['areaPrivativa']:.0f} m² priv."
                if isinstance(prop.get("areaPrivativa"), (int, float))
                else ""
            )
            discount = (
                f" • {prop['desconto']:.2f}% desconto"
                if isinstance(prop.get("desconto"), (int, float))
                else ""
            )
            label = (
                f"{prop.get('tipoImovel') or 'Imóvel'} — "
                f"{prop.get('bairro') or 'Bairro não informado'}, {prop.get('cidade') or 'BA'}"
            )
            link = str(prop.get("link") or "")
            address = str(prop.get("endereco") or "")

            text_lines += [
                label,
                f"{money(prop.get('preco'))}{bedrooms}{area}{discount}",
                address,
                link,
                "",
            ]
            html_blocks.append(
                "<div style='border:1px solid #dbe5ee;border-radius:12px;padding:14px;margin:10px 0'>"
                f"<strong>{html.escape(label)}</strong><br>"
                f"<span style='font-size:18px;color:#075985;font-weight:700'>{html.escape(money(prop.get('preco')))}</span>"
                f"<span style='color:#667085'>{html.escape(bedrooms + area + discount)}</span><br>"
                f"<span style='color:#667085'>{html.escape(address)}</span><br>"
                f"<a href='{html.escape(link, quote=True)}'>Ver imóvel na CAIXA</a>"
                "</div>"
            )

        if len(items) > 25:
            remaining = len(items) - 25
            text_lines.append(f"... e mais {remaining} imóveis neste alerta.\n")
            html_blocks.append(f"<p>... e mais {remaining} imóveis neste alerta.</p>")

    html_blocks.append(
        "<p style='font-size:12px;color:#667085;margin-top:28px'>"
        "Fonte: lista pública de imóveis da CAIXA. Confirme disponibilidade, edital, ocupação e condições no canal oficial."
        "</p>"
    )
    msg.set_content("\n".join(text_lines))
    msg.add_alternative(
        "<div style='font-family:Arial,sans-serif;color:#172235;max-width:760px'>"
        + "".join(html_blocks)
        + "</div>",
        subtype="html",
    )
    return msg


def main() -> int:
    user = os.getenv("SMTP_USER", "").strip()
    password = (
        os.getenv("SMTP_APP_PASSWORD", "").strip()
        or os.getenv("SMTP_PASSWORD", "").strip()
    )
    recipients = [
        item.strip()
        for item in os.getenv("ALERT_EMAIL_TO", "").split(",")
        if item.strip()
    ]

    if not user or not password or not recipients:
        print(
            "Alertas por e-mail ignorados: configure SMTP_USER, "
            "SMTP_APP_PASSWORD (ou SMTP_PASSWORD) e ALERT_EMAIL_TO."
        )
        return 0

    payload = load_json(DATA_FILE, {})
    new_properties = [
        prop for prop in payload.get("properties", [])
        if prop.get("newOnLatestUpdate")
    ]
    if not new_properties:
        print("Nenhum imóvel novo nesta atualização; nenhum e-mail enviado.")
        return 0

    config = load_json(
        CONFIG_FILE,
        {"enabled": True, "alerts": [{"name": "Bahia", "cities": []}]},
    )
    if not config.get("enabled", True):
        print("Alertas por e-mail desativados em config/email-alerts.json.")
        return 0

    matches_by_rule: list[tuple[dict, list[dict]]] = []
    for rule in config.get("alerts", []):
        if rule.get("enabled", True) is False:
            continue
        items = [prop for prop in new_properties if matches(prop, rule)]
        if items:
            items.sort(
                key=lambda prop: (
                    prop.get("desconto") or 0,
                    -(prop.get("preco") or 10**15),
                ),
                reverse=True,
            )
            matches_by_rule.append((rule, items))

    if not matches_by_rule:
        print("Existem imóveis novos, mas nenhum atende aos critérios de e-mail.")
        return 0

    msg = build_email(matches_by_rule, payload)
    sender = os.getenv("SMTP_FROM", "").strip() or user
    msg["From"] = sender
    msg["To"] = ", ".join(recipients)

    host = os.getenv("SMTP_HOST", "smtp.gmail.com").strip() or "smtp.gmail.com"
    port = int(os.getenv("SMTP_PORT", "465") or "465")
    context = ssl.create_default_context()

    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=context, timeout=45) as smtp:
            smtp.login(user, password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=45) as smtp:
            smtp.starttls(context=context)
            smtp.login(user, password)
            smtp.send_message(msg)

    print(f"E-mail enviado para {len(recipients)} destinatário(s).")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERRO AO ENVIAR E-MAIL: {exc}", file=sys.stderr)
        raise
