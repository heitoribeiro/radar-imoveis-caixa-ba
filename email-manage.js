const ALERT_API='https://gkkkqvpnunpdbzpdbqky.supabase.co/functions/v1';

function installAlertManager(){
  const form=document.querySelector('#emailAlertForm');
  const input=document.querySelector('#emailInput');
  const status=document.querySelector('#emailStatus');
  if(!form||!input||!status||document.querySelector('#manageEmailAlertsButton')) return;

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

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',installAlertManager,{once:true});
else installAlertManager();
