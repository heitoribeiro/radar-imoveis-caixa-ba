# Separação de workflows

Objetivo: publicar mudanças visuais sem refazer a coleta nacional da CAIXA.

- `pages.yml`: apenas publica a interface e reutiliza a última base já publicada.
- `update-data.yml`: roda diariamente às 06:05 (Brasília), consulta as 27 UFs, atualiza o histórico e publica a nova base.
