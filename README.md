# Radar de Imóveis CAIXA — Bahia

Painel web/PWA independente para acompanhar a lista pública de imóveis da CAIXA no estado da Bahia.

## O que o painel faz

- atualização diária automática da lista oficial da CAIXA às 06:05 (Bahia);
- histórico da primeira detecção de cada número de imóvel;
- destaque de imóveis novos;
- filtros por cidade, bairro, tipo de imóvel, preço, desconto, quartos, WC/banheiros, vagas, financiamento, modalidade e área privativa;
- ordenação por inclusão mais recente, preço, desconto, valor por m² e área;
- favoritos salvos no navegador;
- exportação dos resultados filtrados para CSV;
- link compartilhável da pesquisa com os filtros na URL;
- atalhos para mapa e anúncio oficial da CAIXA;
- PWA e notificações do navegador usando um perfil de alerta baseado nos filtros atuais;
- alerta diário por e-mail opcional, executado pelo GitHub Actions.

## Fonte oficial

- Página de download: `https://venda-imoveis.caixa.gov.br/sistema/download-lista.asp`
- CSV Bahia: `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_BA.csv`

## Alertas por e-mail

O envio é feito pelo workflow sem expor credenciais no código. Para Gmail, crie três **Repository Secrets** em `Settings > Secrets and variables > Actions`:

- `SMTP_USER`: conta Gmail que enviará os alertas;
- `SMTP_APP_PASSWORD`: senha de app do Google (não use a senha normal da conta);
- `ALERT_EMAIL_TO`: destinatário. Pode conter mais de um e-mail separado por vírgula.

Os critérios ficam em `config/email-alerts.json`. É possível criar vários perfis de alerta no mesmo arquivo, por exemplo por cidade, faixa de preço ou quantidade mínima de quartos.

Se os Secrets não estiverem configurados, o workflow apenas ignora o envio de e-mail e continua atualizando/publicando o painel normalmente.

## Arquitetura

O GitHub Pages continua totalmente estático. O GitHub Actions executa diariamente `scripts/update_caixa.py`, gera `data/imoveis-ba.json`, compara a lista com `data/first-seen.json`, tenta enviar os alertas de e-mail e publica o artefato no Pages.

> Projeto independente, sem vínculo oficial com a CAIXA. Sempre confirme disponibilidade, edital, ocupação, débitos, condições e financiamento diretamente no canal oficial.
