// Bootstrap robusto do mapa. Carrega Leaflet com múltiplos fallbacks antes de iniciar o app.
const MAP_STATUS = () => document.querySelector('#mapStatus');
const BROKER_API = 'https://gkkkqvpnunpdbzpdbqky.supabase.co/functions/v1';

function addLeafletCss() {
  if (document.querySelector('link[data-radar-leaflet-fallback]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
  link.dataset.radarLeafletFallback = '1';
  link.onerror = () => {
    link.onerror = null;
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
  };
  document.head.appendChild(link);
}

function loadScript(url, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      s.remove();
      reject(new Error(`Timeout carregando ${url}`));
    }, timeoutMs);
    s.src = url;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    s.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      s.remove();
      reject(new Error(`Falha carregando ${url}`));
    };
    document.head.appendChild(s);
  });
}

async function ensureLeaflet() {
  addLeafletCss();
  if (window.L) return true;
  const status = MAP_STATUS();
  if (status) status.textContent = 'Carregando mapa…';
  const urls = [
    'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
  ];
  for (const url of urls) {
    try {
      await loadScript(url);
      if (window.L) return true;
    } catch (e) {
      console.warn('[Radar CAIXA] CDN do mapa indisponível:', e.message);
    }
  }
  return false;
}

function hardenTileLayer() {
  if (!window.L || window.L.__radarTilePatch) return;
  const original = window.L.tileLayer;
  window.L.tileLayer = function(url, options) {
    if (typeof url === 'string' && url.includes('{s}.tile.openstreetmap.org')) {
      url = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    }
    const layer = original.call(this, url, options);
    let errors = 0;
    layer.on('tileerror', () => {
      errors += 1;
      if (errors === 4) {
        const status = MAP_STATUS();
        if (status) status.textContent = 'Mapa carregado, mas a rede está bloqueando algumas imagens cartográficas. Tentando novamente…';
      }
    });
    return layer;
  };
  window.L.__radarTilePatch = true;
}

function brokerStyles() {
  if (document.querySelector('#brokerMarketplaceStyles')) return;
  const s=document.createElement('style');
  s.id='brokerMarketplaceStyles';
  s.textContent=`
  .broker-panel{display:grid;grid-template-columns:1.3fr .7fr;gap:24px;align-items:center;overflow:hidden;position:relative}
  .broker-panel:after{content:'';position:absolute;right:-70px;top:-90px;width:250px;height:250px;border-radius:50%;background:rgba(14,116,144,.08);pointer-events:none}
  .broker-kicker{font-size:.74rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#0e7490}
  .broker-panel h2{margin:.35rem 0 .55rem;font-size:1.55rem}.broker-panel p{margin:0;color:#64748b;line-height:1.55}
  .broker-benefits{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.broker-benefits span{background:#eff6ff;border:1px solid #dbeafe;border-radius:999px;padding:7px 10px;font-size:.78rem;font-weight:700;color:#0f4f75}
  .broker-actions{display:flex;gap:10px;justify-content:flex-end;position:relative;z-index:1}
  .broker-modal{position:fixed;inset:0;z-index:99999;display:none}.broker-modal.open{display:block}.broker-modal__backdrop{position:absolute;inset:0;background:rgba(15,23,42,.65);backdrop-filter:blur(3px)}
  .broker-modal__card{position:relative;width:min(760px,calc(100% - 24px));max-height:92vh;overflow:auto;margin:4vh auto;background:#fff;border-radius:22px;padding:24px;box-shadow:0 24px 80px rgba(15,23,42,.28)}
  .broker-modal__close{position:absolute;right:16px;top:14px;border:0;background:#f1f5f9;border-radius:50%;width:38px;height:38px;font-size:22px;cursor:pointer}
  .broker-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px}.broker-form-grid label{display:flex;flex-direction:column;gap:6px;font-size:.78rem;font-weight:800;color:#475569}.broker-form-grid input,.broker-form-grid select{height:44px;border:1px solid #cbd5e1;border-radius:11px;padding:0 12px;font:inherit;background:white}.broker-form-grid .full{grid-column:1/-1}
  .broker-plan-list{display:grid;gap:10px;margin:14px 0}.broker-plan{display:flex;justify-content:space-between;gap:12px;padding:14px;border:1px solid #dbe4ee;border-radius:14px;cursor:pointer}.broker-plan input{margin-top:3px}.broker-plan strong{display:block}.broker-plan small{color:#64748b}.broker-plan-price{font-size:1.05rem;font-weight:900;color:#075985;white-space:nowrap}
  .broker-note{font-size:.78rem;color:#64748b;margin-top:10px}.broker-status{margin-top:12px;font-size:.86rem}.broker-status.ok{color:#047857}.broker-status.err{color:#b91c1c}
  .broker-contact-button{white-space:nowrap}.broker-list{display:grid;gap:12px;margin-top:14px}.broker-card{border:1px solid #dbe4ee;border-radius:14px;padding:14px}.broker-card strong{display:block;font-size:1rem}.broker-card small{color:#64748b}.broker-card-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.broker-card-actions a{display:inline-flex;text-decoration:none;padding:8px 11px;border-radius:9px;background:#eaf6fb;color:#075985;font-weight:800;font-size:.8rem}
  @media(max-width:720px){.broker-panel{grid-template-columns:1fr}.broker-actions{justify-content:flex-start}.broker-form-grid{grid-template-columns:1fr}.broker-modal__card{margin:2vh auto;max-height:96vh;padding:20px}.broker-plan{flex-direction:column}.broker-plan-price{align-self:flex-start}}
  `;
  document.head.appendChild(s);
}

const bh=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const moneyBR=(cents)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents||0)/100);

function brokerPanelHtml(){return `
<section class="panel broker-panel" id="brokerPartnerPanel">
  <div>
    <span class="broker-kicker">Betel Radar Imóveis • Corretores parceiros</span>
    <h2>Transforme oportunidades em novos clientes</h2>
    <p>Corretores com CRECI validado poderão escolher imóveis da plataforma para atender compradores interessados. A participação será vinculada a um plano pago e o contato só será exibido enquanto a assinatura estiver ativa.</p>
    <div class="broker-benefits"><span>CRECI verificado</span><span>Leads por imóvel</span><span>Contato por WhatsApp</span><span>Pix e cartão</span></div>
  </div>
  <div class="broker-actions"><button class="button button--secondary" id="openBrokerSignup" type="button">Quero ser corretor parceiro</button></div>
</section>`}

function brokerModalHtml(){return `
<div class="broker-modal" id="brokerSignupModal" aria-hidden="true">
 <div class="broker-modal__backdrop" data-broker-close></div>
 <div class="broker-modal__card" role="dialog" aria-modal="true" aria-labelledby="brokerModalTitle">
  <button class="broker-modal__close" data-broker-close aria-label="Fechar">×</button>
  <span class="broker-kicker">Área profissional</span><h2 id="brokerModalTitle">Cadastro de corretor parceiro</h2>
  <p>Cadastre seus dados profissionais. O perfil só será exibido aos compradores depois do pagamento e da validação do CRECI.</p>
  <div id="brokerPlans" class="broker-plan-list"><small>Carregando planos…</small></div>
  <form id="brokerSignupForm">
   <div class="broker-form-grid">
    <label>Nome completo<input name="name" required minlength="3"></label>
    <label>E-mail<input name="email" type="email" required></label>
    <label>Nº do CRECI<input name="creci_number" required placeholder="Ex.: 12345"></label>
    <label>UF do CRECI<select name="creci_uf" required>${['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(u=>`<option>${u}</option>`).join('')}</select></label>
    <label>WhatsApp<input name="whatsapp" required inputmode="tel" placeholder="(71) 99999-9999"></label>
    <label>Telefone<input name="phone" inputmode="tel"></label>
    <label>Cidade de atuação<input name="city" placeholder="Ex.: Salvador"></label>
    <label>UF de atuação<select name="state"><option value="">Selecione</option>${['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(u=>`<option>${u}</option>`).join('')}</select></label>
    <input class="full" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
   </div>
   <input type="hidden" name="plan_id" id="brokerPlanId">
   <p class="broker-note">O pagamento será processado pelo provedor externo. A plataforma não armazena número de cartão. O cadastro profissional fica sujeito à validação do CRECI.</p>
   <button class="button button--secondary" id="brokerSubmit" type="submit">Continuar cadastro</button>
   <div id="brokerSignupStatus" class="broker-status"></div>
  </form>
 </div>
</div>
<div class="broker-modal" id="brokerContactModal" aria-hidden="true">
 <div class="broker-modal__backdrop" data-broker-contact-close></div>
 <div class="broker-modal__card" role="dialog" aria-modal="true">
  <button class="broker-modal__close" data-broker-contact-close aria-label="Fechar">×</button>
  <span class="broker-kicker">Atendimento profissional</span><h2>Corretores parceiros deste imóvel</h2>
  <p>Os profissionais abaixo possuem cadastro ativo na plataforma e CRECI validado. Confirme condições e responsabilidades diretamente com o corretor escolhido.</p>
  <div id="brokerContactList" class="broker-list"><small>Carregando…</small></div>
 </div>
</div>`}

async function loadBrokerPlans(){
 const box=document.querySelector('#brokerPlans'), hidden=document.querySelector('#brokerPlanId'); if(!box||!hidden)return;
 try{
  const r=await fetch(`${BROKER_API}/broker-plans`); const b=await r.json(); const plans=Array.isArray(b.plans)?b.plans:[];
  if(!plans.length){box.innerHTML='<div class="broker-plan"><div><strong>Pré-cadastro de lançamento</strong><small>Os planos pagos estão sendo configurados. Você pode deixar seu cadastro profissional agora.</small></div></div>';hidden.value='';return;}
  box.innerHTML=plans.map((p,i)=>`<label class="broker-plan"><span><input type="radio" name="broker_plan_pick" value="${bh(p.id)}" ${i===0?'checked':''}> <strong>${bh(p.name)}</strong><small>${bh(p.description||'Plano profissional')}</small></span><span class="broker-plan-price">${moneyBR(p.price_cents)}${p.billing_interval==='monthly'?'/mês':p.billing_interval==='annual'?'/ano':''}</span></label>`).join('');
  hidden.value=plans[0].id; box.addEventListener('change',e=>{const t=e.target;if(t?.name==='broker_plan_pick')hidden.value=t.value});
 }catch{box.innerHTML='<small>Não foi possível carregar os planos agora. O pré-cadastro continua disponível.</small>';hidden.value='';}
}

function openBrokerSignup(){const m=document.querySelector('#brokerSignupModal');if(m){m.classList.add('open');m.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';loadBrokerPlans();}}
function closeBrokerSignup(){const m=document.querySelector('#brokerSignupModal');if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true');document.body.style.overflow='';}}
function closeBrokerContact(){const m=document.querySelector('#brokerContactModal');if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true');document.body.style.overflow='';}}

async function submitBrokerForm(ev){
 ev.preventDefault();const form=ev.currentTarget,btn=document.querySelector('#brokerSubmit'),status=document.querySelector('#brokerSignupStatus');btn.disabled=true;status.className='broker-status';status.textContent='Salvando cadastro…';
 const fd=new FormData(form),body=Object.fromEntries(fd.entries());body.return_url=`${location.origin}${location.pathname}`;
 try{const r=await fetch(`${BROKER_API}/broker-register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const b=await r.json().catch(()=>({}));if(r.ok&&b.checkout_url){status.className='broker-status ok';status.textContent='Cadastro criado. Abrindo pagamento seguro…';location.href=b.checkout_url;return;}if(r.ok||r.status===503){status.className='broker-status ok';status.textContent=b.message||'Cadastro salvo.';}else{status.className='broker-status err';status.textContent=b.message||'Não foi possível concluir o cadastro.';}}catch(e){status.className='broker-status err';status.textContent='Falha de conexão. Tente novamente.';}finally{btn.disabled=false;}
}

async function openBrokerContact(propertyKey){
 const m=document.querySelector('#brokerContactModal'),list=document.querySelector('#brokerContactList');if(!m||!list)return;m.classList.add('open');m.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';list.innerHTML='<small>Buscando corretores parceiros…</small>';
 try{const r=await fetch(`${BROKER_API}/brokers-for-property?property_key=${encodeURIComponent(propertyKey)}`);const b=await r.json();const brokers=Array.isArray(b.brokers)?b.brokers:[];if(!brokers.length){list.innerHTML='<div class="broker-card"><strong>Ainda não há corretor parceiro associado a este imóvel.</strong><small>Se você é corretor, pode se cadastrar e escolher oportunidades para atendimento.</small><div class="broker-card-actions"><a href="#" id="brokerBecomePartner">Quero ser parceiro</a></div></div>';document.querySelector('#brokerBecomePartner')?.addEventListener('click',e=>{e.preventDefault();closeBrokerContact();openBrokerSignup()});return;}list.innerHTML=brokers.map(b=>{const wa=String(b.whatsapp||'').replace(/\D/g,'');return `<div class="broker-card"><strong>${bh(b.name)}</strong><small>${bh(b.creci||'')} ${b.city?`• ${bh(b.city)} ${bh(b.state||'')}`:''}</small>${b.bio?`<p>${bh(b.bio)}</p>`:''}<div class="broker-card-actions">${wa?`<a href="https://wa.me/55${wa.replace(/^55/,'')}" target="_blank" rel="noopener">WhatsApp</a>`:''}${b.phone?`<a href="tel:${bh(String(b.phone).replace(/[^\d+]/g,''))}">Ligar</a>`:''}</div></div>`}).join('');}catch{list.innerHTML='<div class="broker-card"><strong>Não foi possível carregar os profissionais agora.</strong><small>Tente novamente em instantes.</small></div>';}
}

function decoratePropertyCards(){document.querySelectorAll('.property-card[data-key]').forEach(card=>{if(card.querySelector('.broker-contact-button'))return;const links=card.querySelector('.card-links');if(!links)return;const btn=document.createElement('button');btn.type='button';btn.className='photo-button broker-contact-button';btn.textContent='Corretor';btn.addEventListener('click',()=>openBrokerContact(card.dataset.key||''));links.prepend(btn);});}

function initBrokerMarketplace(){
 brokerStyles();const map=document.querySelector('#mapPanel');if(map&&!document.querySelector('#brokerPartnerPanel'))map.insertAdjacentHTML('beforebegin',brokerPanelHtml());if(!document.querySelector('#brokerSignupModal'))document.body.insertAdjacentHTML('beforeend',brokerModalHtml());
 document.querySelector('#openBrokerSignup')?.addEventListener('click',openBrokerSignup);document.querySelector('#brokerSignupForm')?.addEventListener('submit',submitBrokerForm);document.querySelectorAll('[data-broker-close]').forEach(x=>x.addEventListener('click',closeBrokerSignup));document.querySelectorAll('[data-broker-contact-close]').forEach(x=>x.addEventListener('click',closeBrokerContact));
 const grid=document.querySelector('#cardsGrid');if(grid){decoratePropertyCards();new MutationObserver(decoratePropertyCards).observe(grid,{childList:true,subtree:true});}
 const payment=new URL(location.href).searchParams.get('broker_payment');if(payment){const panel=document.querySelector('#brokerPartnerPanel');if(panel){const msg=document.createElement('div');msg.className='broker-status '+(payment==='success'?'ok':'');msg.textContent=payment==='success'?'Pagamento recebido. Seu cadastro seguirá para validação do CRECI.':payment==='pending'?'Pagamento em processamento. Atualizaremos sua assinatura assim que houver confirmação.':'O pagamento não foi concluído. Você pode tentar novamente pelo cadastro do corretor.';panel.querySelector('div')?.appendChild(msg);}const u=new URL(location.href);u.searchParams.delete('broker_payment');history.replaceState(null,'',u);}
}

(async () => {
  const ok = await ensureLeaflet();
  if (!ok) {
    const status = MAP_STATUS();
    if (status) status.textContent = 'Não foi possível carregar a biblioteca do mapa nesta rede. Recarregue a página ou tente outra conexão.';
    console.error('[Radar CAIXA] Leaflet não pôde ser carregado por nenhum CDN.');
  } else {
    hardenTileLayer();
  }
  try {
    await import('./app-core.js?mapfix=20260915-2');
    initBrokerMarketplace();
  } catch (e) {
    console.error('[Radar CAIXA] Falha ao iniciar aplicação:', e);
    const status = MAP_STATUS();
    if (status && ok) status.textContent = 'O mapa foi carregado, mas ocorreu uma falha ao iniciar os dados. Recarregue a página.';
  }
})();
