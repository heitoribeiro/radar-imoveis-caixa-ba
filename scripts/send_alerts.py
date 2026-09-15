#!/usr/bin/env python3
from __future__ import annotations
import json, os, smtplib, ssl
from email.message import EmailMessage
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data'/'imoveis-ba.json'
CONFIG=ROOT/'data'/'email-alerts.json'

def norm(v): return str(v or '').strip().upper()
def matches(p,cfg):
    cities={norm(x) for x in cfg.get('cities',[]) if x}
    types={norm(x) for x in cfg.get('types',[]) if x}
    if cities and norm(p.get('cidade')) not in cities:return False
    if types and norm(p.get('tipoImovel')) not in types:return False
    if cfg.get('minRooms') and (p.get('quartos') or 0)<int(cfg['minRooms']):return False
    if cfg.get('maxPrice') and (p.get('preco') is None or p['preco']>float(cfg['maxPrice'])):return False
    if cfg.get('minDiscount') and (p.get('desconto') or 0)<float(cfg['minDiscount']):return False
    if cfg.get('financing') and norm(p.get('financiamento'))!=norm(cfg['financing']):return False
    return True

def brl(v):
    if v is None:return 'Sob consulta'
    s=f'{v:,.2f}'.replace(',','X').replace('.',',').replace('X','.')
    return f'R$ {s}'

def main():
    if not DATA.exists():return 0
    payload=json.loads(DATA.read_text(encoding='utf-8'))
    cfg=json.loads(CONFIG.read_text(encoding='utf-8')) if CONFIG.exists() else {'enabled':False}
    if not cfg.get('enabled',False):print('Alertas por e-mail desativados no config.');return 0
    new=[p for p in payload.get('properties',[]) if p.get('newOnLatestUpdate') and matches(p,cfg)]
    if not new:print('Nenhum imóvel novo atende aos critérios de e-mail.');return 0
    to=os.getenv('ALERT_EMAIL_TO','').strip();user=os.getenv('SMTP_USER','').strip();pwd=os.getenv('SMTP_PASSWORD','').strip()
    if not to or not user or not pwd:print('Segredos de e-mail não configurados; envio ignorado.');return 0
    host=os.getenv('SMTP_HOST','smtp.gmail.com');port=int(os.getenv('SMTP_PORT','465'));sender=os.getenv('SMTP_FROM',user)
    msg=EmailMessage();msg['Subject']=f'Radar CAIXA BA: {len(new)} novo(s) imóvel(is)';msg['From']=sender;msg['To']=to
    lines=[f'Foram encontrados {len(new)} novos imóveis na atualização de {payload.get("updatedAt","hoje")} que atendem aos seus critérios.','']
    for p in new[:30]:
        lines += [f'{p.get("tipoImovel","Imóvel")} — {p.get("cidade","BA")} / {p.get("bairro","")}',f'Preço: {brl(p.get("preco"))} | Desconto: {p.get("desconto") or 0}% | Quartos: {p.get("quartos") or 0}',p.get('link',''),'']
    if len(new)>30: lines.append(f'+ {len(new)-30} imóvel(is) adicional(is). Consulte o painel.')
    lines += ['Painel: https://heitoribeiro.github.io/radar-imoveis-caixa-ba/','Fonte: lista pública de imóveis da CAIXA Econômica Federal.']
    msg.set_content('\n'.join(lines))
    ctx=ssl.create_default_context()
    if port==465:
        with smtplib.SMTP_SSL(host,port,context=ctx,timeout=30) as s:s.login(user,pwd);s.send_message(msg)
    else:
        with smtplib.SMTP(host,port,timeout=30) as s:s.starttls(context=ctx);s.login(user,pwd);s.send_message(msg)
    print(f'E-mail enviado para {to}: {len(new)} imóvel(is).');return 0
if __name__=='__main__':raise SystemExit(main())
