const ALERT_API='https://gkkkqvpnunpdbzpdbqky.supabase.co/functions/v1';

function installAlertManager(){
  const form=document.querySelector('#emailAlertForm');
  const input=document.querySelector('#emailInput');
  const status=document.querySelector('#emailStatus');
  if(!form||!input||!status) return;

  if(status.textContent.includes('GitHub')){
    status.textContent='Enviaremos uma confirmação para ativar o alerta. Seus filtros atuais serão usados no monitoramento.';
  }

  if(document.querySelector('#manageEmailAlertsButton')) return;

  const button=document.createElement('button');
  button.id='manageEmailAlertsButton';
  button.type='button';
  button.className='button button--outline';
  button.textContent='Gerenciar / cancelar alertas';
  button.style.marginTop='8px';
  form.appendChild(button);

  const note=document.createElement('small');
  note.className='email-status';
  note.style.marginTop='6px';
  note.textContent='Use o mesmo e-mail do cadastro para receber os links de gerenciamento.';
  form.appendChild(note);

  button.addEventListener('click',async()=>{
    const email=String(input.value||'').trim();
    if(!email){
      status.className='email-status error';
      status.textContent='Informe seu e-mail acima para gerenciar os alertas.';
      input.focus();
      return;
    }
    button.disabled=true;
    const oldText=button.textContent;
    button.textContent='Enviando…';
    status.className='email-status';
    status.textContent='Solicitando links de gerenciamento…';
    try{
      const r=await fetch(`${ALERT_API}/alert-manage-request`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email})});
      const body=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(body.message||'Não foi possível solicitar o gerenciamento agora.');
      status.className='email-status success';
      status.textContent=body.message||'Enviamos um e-mail com seus alertas e os links para cancelamento.';
    }catch(e){
      status.className='email-status error';
      status.textContent=e?.message||'Falha ao solicitar o gerenciamento dos alertas.';
    }finally{
      button.disabled=false;
      button.textContent=oldText;
    }
  });
}

function patchBrokerRecurringUi(){
  const panel=document.querySelector('#brokerPartnerPanel');
  const modal=document.querySelector('#brokerSignupModal');
  if(!panel&&!modal) return false;

  if(panel&&!panel.dataset.recurringUi){
    panel.dataset.recurringUi='1';
    const benefits=[...panel.querySelectorAll('.broker-benefits span')];
    const paymentBenefit=benefits.find(el=>/pix|cart[aã]o/i.test(el.textContent||''));
    if(paymentBenefit) paymentBenefit.textContent='Assinatura recorrente';

    const copy=panel.querySelector('p');
    if(copy){
      copy.textContent='Corretores com assinatura ativa e validações profissionais poderão escolher imóveis da plataforma para atender compradores interessados. Os planos mensal e anual têm cobrança recorrente pelo Mercado Pago. Para intermediação de imóveis CAIXA, o credenciamento específico também será conferido.';
    }
  }

  if(modal&&!modal.dataset.recurringUi){
    modal.dataset.recurringUi='1';
    const heading=modal.querySelector('#brokerModalTitle');
    const intro=heading?.nextElementSibling;
    if(intro){
      intro.textContent='Cadastre seus dados profissionais e escolha seu plano. A adesão é uma assinatura recorrente processada pelo Mercado Pago. O pagamento não libera o perfil automaticamente: CRECI e, para intermediação de imóveis CAIXA, o credenciamento específico precisam ser validados.';
    }

    const note=modal.querySelector('.broker-note');
    if(note){
      note.textContent='A cobrança será renovada automaticamente conforme a periodicidade do plano selecionado. O Mercado Pago processa e armazena os dados do meio de pagamento; o Betel Radar Imóveis não armazena número de cartão. A declaração de credenciamento CAIXA continuará pendente até validação administrativa.';
    }

    const submit=modal.querySelector('#brokerSubmit');
    if(submit) submit.textContent='Continuar para assinatura';
  }

  const url=new URL(location.href);
  const returned=url.searchParams.get('broker_subscription');
  if(panel&&returned&&!panel.dataset.subscriptionReturnShown){
    panel.dataset.subscriptionReturnShown='1';
    const msg=document.createElement('div');
    msg.className='broker-status ok';
    msg.style.marginTop='14px';
    msg.textContent='Sua adesão foi enviada ao Mercado Pago. A assinatura será ativada após a confirmação da primeira cobrança. A validação do CRECI e, quando aplicável, do credenciamento CAIXA continua sendo necessária.';
    const target=panel.querySelector('div');
    target?.appendChild(msg);
    url.searchParams.delete('broker_subscription');
    history.replaceState(null,'',url);
  }
  return true;
}

function installBrokerRecurringUi(){
  if(patchBrokerRecurringUi()) return;
  const observer=new MutationObserver(()=>{
    if(patchBrokerRecurringUi()) observer.disconnect();
  });
  observer.observe(document.body,{childList:true,subtree:true});
  setTimeout(()=>observer.disconnect(),15000);
}

function installEnhancements(){
  installAlertManager();
  installBrokerRecurringUi();
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',installEnhancements,{once:true});
else installEnhancements();
