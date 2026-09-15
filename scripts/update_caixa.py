#!/usr/bin/env python3
from __future__ import annotations
import csv, io, json, re, sys, unicodedata
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[1]
DATA_FILE=ROOT/'data'/'imoveis-ba.json'
FIRST_SEEN_FILE=ROOT/'data'/'first-seen.json'
SOURCE_URL='https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_BA.csv'
SOURCE_PAGE='https://venda-imoveis.caixa.gov.br/sistema/download-lista.asp'
BAHIA_TZ=timezone(timedelta(hours=-3))

def now_bahia(): return datetime.now(timezone.utc).astimezone(BAHIA_TZ)
def normalize(v):
    v=unicodedata.normalize('NFD',str(v or ''))
    v=''.join(c for c in v if unicodedata.category(c)!='Mn').replace('º','').replace('°','')
    return re.sub(r'[^a-zA-Z0-9]+',' ',v).strip().lower()
def download():
    req=Request(SOURCE_URL,headers={'User-Agent':'Mozilla/5.0 (compatible; RadarImoveisBA/2.0)','Accept':'text/csv,application/octet-stream,*/*'})
    with urlopen(req,timeout=60) as r: raw=r.read()
    if len(raw)<200: raise RuntimeError('Lista da CAIXA vazia.')
    for enc in ('cp1252','latin1','utf-8'):
        try:return raw.decode(enc)
        except UnicodeDecodeError: pass
    raise RuntimeError('Codificação do CSV não reconhecida.')
def generation_date(text):
    m=re.search(r'Data\s+de\s+gera(?:ç|c)[aã]o\s*:?\s*;?\s*(\d{2}/\d{2}/\d{4})',text,re.I) or re.search(r'(\d{2}/\d{2}/\d{4})',text)
    if not m:return None
    d,mn,y=m.group(1).split('/');return f'{y}-{mn}-{d}'
def parse_money(v):
    t=str(v or '').strip().replace('R$','').replace(' ','');t=re.sub(r'[^0-9,.-]','',t)
    if not t:return None
    if ',' in t:t=t.replace('.','').replace(',','.')
    try:return float(t)
    except ValueError:return None
def parse_num(text, pattern):
    m=re.search(pattern,text,re.I)
    return int(m.group(1)) if m else 0
def parse_area(text,label):
    m=re.search(r'([\d.,]+)\s+de\s+área\s+'+label,text,re.I)
    return parse_money(m.group(1)) if m else None
def enrich(desc):
    d=desc or ''
    tipo=(d.split(',',1)[0].strip() if d else '') or 'Não informado'
    quartos=parse_num(d,r'(\d+)\s*qto\(s\)')
    vagas=parse_num(d,r'(\d+)\s*vaga\(s\)')
    m=re.search(r'(\d+)\s*WC',d,re.I)
    banheiros=int(m.group(1)) if m else (1 if re.search(r'\bWC\b',d,re.I) else 0)
    return {'tipoImovel':tipo,'quartos':quartos,'banheiros':banheiros,'vagas':vagas,'areaTotal':parse_area(d,'total'),'areaPrivativa':parse_area(d,'privativa'),'areaTerreno':parse_area(d,'do terreno')}
def find_header(lines):
    for i,line in enumerate(lines[:20]):
        cells=[normalize(c) for c in next(csv.reader([line],delimiter=';'))]
        if any('imovel' in c for c in cells) and 'cidade' in cells:return i
    raise RuntimeError('Cabeçalho da CAIXA não reconhecido.')
def col_index(headers,pred):
    for i,h in enumerate(map(normalize,headers)):
        if pred(h):return i
    return -1
def get(row,i): return row[i].strip() if 0<=i<len(row) else ''
def absolute_link(v,n):
    v=v.strip()
    if v.startswith(('http://','https://')):return v
    if v.startswith('/'):return 'https://venda-imoveis.caixa.gov.br'+v
    digits=re.sub(r'\D','',n)
    return f'https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnOrigem=index&hdnimovel={digits}' if digits else SOURCE_PAGE

def parse_properties(text):
    lines=text.splitlines();hi=find_header(lines);reader=csv.reader(io.StringIO('\n'.join(lines[hi:])),delimiter=';');headers=next(reader)
    idx={'number':col_index(headers,lambda h:'imovel' in h and (h.startswith('n ') or 'numero' in h or h.startswith('n'))),'uf':col_index(headers,lambda h:h=='uf'),'city':col_index(headers,lambda h:h=='cidade'),'neighborhood':col_index(headers,lambda h:h=='bairro'),'address':col_index(headers,lambda h:'endereco' in h),'price':col_index(headers,lambda h:h=='preco'),'appraisal':col_index(headers,lambda h:'valor' in h and 'avaliacao' in h),'discount':col_index(headers,lambda h:'desconto' in h),'financing':col_index(headers,lambda h:'financiamento' in h),'description':col_index(headers,lambda h:'descricao' in h),'modality':col_index(headers,lambda h:'modalidade' in h),'link':col_index(headers,lambda h:'link' in h)}
    if idx['number']<0 or idx['city']<0 or idx['price']<0: raise RuntimeError(f'Estrutura do CSV mudou: {headers}')
    out=[];seen=set()
    for row in reader:
        number=get(row,idx['number']);city=get(row,idx['city']).upper()
        if not number or not city or number in seen:continue
        seen.add(number);desc=get(row,idx['description'])
        p={'numeroImovel':number,'uf':get(row,idx['uf']) or 'BA','cidade':city,'bairro':get(row,idx['neighborhood']),'endereco':get(row,idx['address']),'preco':parse_money(get(row,idx['price'])),'valorAvaliacao':parse_money(get(row,idx['appraisal'])),'desconto':parse_money(get(row,idx['discount']).replace('%','')),'financiamento':get(row,idx['financing']),'descricao':desc,'modalidade':get(row,idx['modality']),'link':absolute_link(get(row,idx['link']),number)}
        p.update(enrich(desc));out.append(p)
    return out

def load_registry():
    if not FIRST_SEEN_FILE.exists():return {'initialized':False,'baselineCreatedAt':None,'items':{}}
    try:
        d=json.loads(FIRST_SEEN_FILE.read_text(encoding='utf-8'))
        if not isinstance(d.get('items'),dict):d['items']={}
        return d
    except Exception:return {'initialized':False,'baselineCreatedAt':None,'items':{}}

def main():
    DATA_FILE.parent.mkdir(parents=True,exist_ok=True);text=download();props=parse_properties(text)
    if not props:raise RuntimeError('Nenhum imóvel identificado.')
    now=now_bahia();now_iso=now.isoformat(timespec='seconds');today=now.date().isoformat();reg=load_registry();items=reg.setdefault('items',{});initialized=bool(reg.get('initialized')) and bool(items);new_count=0
    for p in props:
        n=p['numeroImovel'];is_new=initialized and n not in items
        if n not in items:items[n]=today
        p['firstSeen']=items[n];p['newOnLatestUpdate']=is_new;new_count+=int(is_new)
    if not initialized:
        reg['initialized']=True;reg['baselineCreatedAt']=today;new_count=0
        for p in props:p['newOnLatestUpdate']=False
    reg['lastUpdatedAt']=now_iso;reg['currentCount']=len(props)
    FIRST_SEEN_FILE.write_text(json.dumps(reg,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    props.sort(key=lambda p:(p.get('firstSeen') or '',p.get('numeroImovel') or ''),reverse=True)
    payload={'state':'BA','source':SOURCE_PAGE,'csvSource':SOURCE_URL,'generatedAt':generation_date(text),'fetchedAt':now_iso,'updatedAt':today,'total':len(props),'newCount':new_count,'properties':props}
    DATA_FILE.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    print(f'Atualização concluída: {len(props)} imóveis; {new_count} novos.')
    return 0
if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception as exc:print(f'ERRO: {exc}',file=sys.stderr);raise
