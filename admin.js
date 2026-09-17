(()=>{
const API='https://gkkkqvpnunpdbzpdbqky.supabase.co/functions/v1';
let token='';
let brokers=[];
const $=s=>document.querySelector(s);
const esc=(v='')=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const norm=(v='')=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const money=c=>Number.isFinite(Number(c))?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(c)/100):'—';
const date=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(d)};
const labels={
  active:'Ativo',pending_review:'Em validação',pending_payment:'Aguardando pagamento',rejected:'Rejeitado',suspended:'Suspenso',cancelled:'Cancelado',
  verified:'Verificado',pending:'Pendente',not_informed:'Não informado',past_due:'Pagamento pendente',paused:'Pausada',
  manual_verified:'Verificado manualmente',manual_rejected:'Rejeitado manualmente',not_found:'Não localizado',inconclusive:'Inconclusivo',error:'Erro de consulta'
};
const label=v=>labels[String(v||'').toLowerCase()]||String(v||'—');
const badgeClass=v=>['active','verified','manual_verified'].includes(String(v))?'ok':['rejected','manual_rejected','not_found','suspended','cancelled'].includes(String(v))?'bad':'warn';

async function call(action,payload={}){
  const r=await fetch(`${API}/broker-admin`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,action,...payload})});
  const out=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(out.message||'Falha na operação.');
  return out;
}
async function requestAccess(e){
  e.preventDefault();const email=$('#adminEmail').value.trim();const btn=$('#adminAccessButton'),st=$('#adminAccessStatus');
  btn.disabled=true;st.className='status-msg';st.textContent='Enviando…';
  try{const r=await fetch(`${API}/broker-admin-request`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email})});const out=await r.json().catch(()=>({}));if(!r.ok)throw new Error(out.message||'Falha no envio.');st.className='status-msg ok';st.textContent=out.message||'Verifique seu e-mail.'}
  catch(err){st.className='status-msg err';st.textContent=err.message||'Não foi possível enviar o acesso.'}finally{btn.disabled=false}
}
async function load(){
  const st=$('#adminStatus');st.className='status-msg';st.textContent='Carregando corretores…';
  try{const out=await call('list');brokers=out.brokers||[];$('#loginPanel').style.display='none';$('#dashboard').classList.add('open');st.textContent='';renderMetrics();renderList()}
  catch(err){$('#dashboard').classList.remove('open');$('#loginPanel').style.display='block';const a=$('#adminAccessStatus');a.className='status-msg err';a.textContent=err.message||'Acesso expirado.';token=''}
}
function renderMetrics(){
  $('#metricTotal').textContent=brokers.length;
  $('#metricReview').textContent=brokers.filter(b=>b.status==='pending_review').length;
  $('#metricCreci').textContent=brokers.filter(b=>b.creci_status!=='verified').length;
  $('#metricCaixa').textContent=brokers.filter(b=>b.caixa_credential_status!=='verified').length;
}
function latestCheckHtml(c){if(!c)return'<span class="source">Nenhuma consulta registrada.</span>';return `<div class="source"><strong>${esc(label(c.result_status))}</strong> • ${esc(date(c.checked_at))}${c.source_url?` • <a href="${esc(c.source_url)}" target="_blank" rel="noopener">fonte</a>`:''}${c.raw_excerpt?`<div style="margin-top:5px;color:#64748b">${esc(c.raw_excerpt)}</div>`:''}</div>`}
function brokerHtml(b){
  const s=b.subscription||{},creci=b.checks?.creci,caixa=b.checks?.caixa;
  return `<article class="panel broker" data-broker="${esc(b.id)}">
    <div class="broker-head"><div class="broker-title"><h3>${esc(b.name)}</h3><p>${esc(b.email)} • CRECI ${esc(b.creci_uf)}-${esc(b.creci_number)} • ${esc(b.city||'—')}/${esc(b.state||b.creci_uf||'—')}</p></div><div class="badges"><span class="badge ${badgeClass(b.status)}">Perfil: ${esc(label(b.status))}</span><span class="badge ${badgeClass(s.status)}">Assinatura: ${esc(label(s.status||'sem assinatura'))}</span></div></div>
    <div class="broker-grid"><div class="info"><small>Plano / cobrança</small><strong>${s.amount_cents?money(s.amount_cents):'—'}${s.broker_plans?.billing_interval==='monthly'?'/mês':''}</strong></div><div class="info"><small>Próxima cobrança</small><strong>${esc(date(s.next_payment_at))}</strong></div><div class="info"><small>Imóveis selecionados</small><strong>${esc(b.property_count||0)}</strong></div><div class="info"><small>Cadastro</small><strong>${esc(date(b.created_at))}</strong></div></div>
    <div class="verify-grid">
      <section class="verify-box"><h4>CRECI</h4><p>Status atual: <strong>${esc(label(b.creci_status))}</strong>. A consulta oficial deve confirmar número, nome e situação ativa/regular.</p>${latestCheckHtml(creci)}<div class="verify-actions"><a class="btn btn-outline" href="${esc(b.official_links?.creci||'#')}" target="_blank" rel="noopener">Abrir CRECI oficial</a><button class="btn btn-outline" data-action="creci-check">Registrar consulta</button><button class="btn btn-ok" data-action="creci-ok">Confirmar ativo</button><button class="btn btn-bad" data-action="creci-bad">Rejeitar</button></div></section>
      <section class="verify-box"><h4>Credenciamento CAIXA</h4><p>Status atual: <strong>${esc(label(b.caixa_credential_status))}</strong>. A checagem automática procura o CRECI na relação oficial para um imóvel da carteira e exige referência a Intermediação.</p>${latestCheckHtml(caixa)}<div class="verify-actions"><button class="btn btn-primary" data-action="caixa-auto">Verificar na CAIXA</button><a class="btn btn-outline" href="${esc(b.official_links?.caixa||'#')}" target="_blank" rel="noopener">Abrir CAIXA</a><button class="btn btn-ok" data-action="caixa-ok">Confirmar</button><button class="btn btn-bad" data-action="caixa-bad">Rejeitar</button></div></section>
    </div>
    <div class="profile-row"><label class="field" style="margin:0"><label>Situação do perfil</label><select data-profile-status><option value="pending_payment" ${b.status==='pending_payment'?'selected':''}>Aguardando pagamento</option><option value="pending_review" ${b.status==='pending_review'?'selected':''}>Em validação</option><option value="active" ${b.status==='active'?'selected':''}>Ativo</option><option value="rejected" ${b.status==='rejected'?'selected':''}>Rejeitado</option><option value="suspended" ${b.status==='suspended'?'selected':''}>Suspenso</option><option value="cancelled" ${b.status==='cancelled'?'selected':''}>Cancelado</option></select></label><button class="btn btn-outline" data-action="profile-save">Salvar situação</button></div>
  </article>`
}
function renderList(){
  const q=norm($('#adminSearch').value),f=$('#adminFilter').value;
  const rows=brokers.filter(b=>{const text=norm([b.name,b.email,b.creci_number,b.creci_uf,b.city,b.state].join(' '));if(q&&!text.includes(q))return false;if(f==='pending'&&!(b.status==='pending_review'||b.creci_status!=='verified'||b.caixa_credential_status!=='verified'))return false;if(f==='active'&&b.status!=='active')return false;if(f==='rejected'&&b.status!=='rejected')return false;return true});
  $('#brokerList').innerHTML=rows.length?rows.map(brokerHtml).join(''):'<div class="panel empty">Nenhum corretor corresponde aos filtros.</div>';
  $('#brokerList').querySelectorAll('[data-action]').forEach(btn=>btn.addEventListener('click',()=>handleAction(btn)));
}
async function handleAction(btn){
  const card=btn.closest('[data-broker]'),id=card?.dataset.broker,b=brokers.find(x=>x.id===id);if(!b)return;
  const action=btn.dataset.action;btn.disabled=true;const st=$('#adminStatus');st.className='status-msg';st.textContent='Processando…';
  try{
    let out;
    if(action==='caixa-auto')out=await call('check_caixa',{broker_id:id});
    else if(action==='creci-check')out=await call('check_creci',{broker_id:id});
    else if(action==='creci-ok'||action==='creci-bad'){const ok=action==='creci-ok';const notes=prompt(ok?'Observação da verificação do CRECI (opcional):':'Motivo/observação da rejeição do CRECI (recomendado):','')||'';out=await call('set_validation',{broker_id:id,type:'creci',status:ok?'verified':'rejected',notes,source_url:b.official_links?.creci||''})}
    else if(action==='caixa-ok'||action==='caixa-bad'){const ok=action==='caixa-ok';const notes=prompt(ok?'Observação da verificação CAIXA (opcional):':'Motivo/observação da rejeição CAIXA (recomendado):','')||'';out=await call('set_validation',{broker_id:id,type:'caixa',status:ok?'verified':'rejected',notes,source_url:b.checks?.caixa?.source_url||b.official_links?.caixa||''})}
    else if(action==='profile-save'){const status=card.querySelector('[data-profile-status]').value;out=await call('set_profile_status',{broker_id:id,status})}
    if(out?.source_url&&action==='creci-check')window.open(out.source_url,'_blank','noopener');
    st.className='status-msg ok';st.textContent=out?.message||'Operação concluída.';await load();
  }catch(err){st.className='status-msg err';st.textContent=err.message||'Falha na operação.'}finally{btn.disabled=false}
}
function init(){
  $('#adminAccessForm').addEventListener('submit',requestAccess);$('#adminSearch').addEventListener('input',renderList);$('#adminFilter').addEventListener('change',renderList);$('#adminRefresh').addEventListener('click',load);
  const u=new URL(location.href);token=u.searchParams.get('admin_token')||'';if(token){u.searchParams.delete('admin_token');history.replaceState(null,'',u.pathname+u.search+u.hash);load()}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();