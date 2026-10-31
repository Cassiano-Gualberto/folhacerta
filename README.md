# FolhaCerta

Continuação do PWA original: leitura **local** de espelhos de ponto e contracheques textuais, estimativa salarial, histórico mensal e comparação com a folha real. Interface responsiva com navegação própria para celular.

## Usar

1. Importe o espelho de ponto em **Calcular**. As horas ficam ligadas à competência do trabalho.
2. Em **Ajustes**, informe salário-base, divisor, competência de pagamento, adiantamento e descontos. Um contracheque importado também pode preencher esses parâmetros quando o salário ainda estiver vazio.
3. Revise as horas (HH:MM ou decimal) e **salve a previsão** para fixar a comparação.
4. Importe o contracheque do pagamento e confirme a qual competência das horas ele pertence. Valores reais não substituem a previsão fixada.
5. Exporte backups JSON antes de trocar de navegador, reinstalar o APK ou limpar dados.

O salário não é pré-preenchido no código público para preservar a privacidade. Não há demonstrações com dados pessoais. Se a primeira previsão só for calculada depois da importação do contracheque, a interface informa que se trata de cálculo com dados já conhecidos, não de previsão anterior ao pagamento.

## Regras e limites

- Salário e divisor (por exemplo, 200/220) são independentes por competência.
- A12 do espelho já inclui redução noturna. Horas de relógio só são reduzidas quando essa opção é selecionada.
- Fatores herdados do motor original: A80 1,975; A72 2,30; B04 1,75. São ajustáveis e devem ser conferidos com o RH. Não equivalem a uma afirmação jurídica sobre a convenção coletiva.
- B04 é convertido em pagamento. Não há saldo acumulável para folga nesta configuração.
- O crédito de 40% para domingos/feriados só é aplicado ao campo de **horas adicionais ainda fora do B04**. Totais importados não recebem o acréscimo novamente.
- DSR por proporção de referência (5/26) ou dias de repouso/úteis é uma **estimativa**, não fórmula oficial da empresa. Também é possível informar horas ou valor exato.
- INSS progressivo de 2026 com truncamento por faixa (ou arredondamento total opcional). IRRF de 2026 com dedução mais vantajosa e redução mensal. Outros anos exigem valores manuais até o cadastro de novas tabelas.
- Minutos do espelho não recuperam frações internas da folha. Ajustes manuais aceitam horas decimais.
- PDFs sem texto, protegidos por senha e modelos não reconhecidos não são interpretados silenciosamente. É possível lançar valores manualmente.

Fontes: [INSS](https://www.gov.br/inss/pt-br/direitos-e-deveres/inscricao-e-contribuicao/tabela-de-contribuicao-mensal), [IRRF 2026](https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026), [documentação eSocial](https://www.gov.br/esocial/pt-br/documentacao-tecnica/).

## Desenvolvimento

Node.js 22 ou superior:

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build
```

O resultado é `dist/`. O PDF.js (Apache-2.0) é empacotado localmente, incluindo worker, CMaps e fontes. Não existe dependência de CDN em execução. `src/legacy-pdf.js` preserva o extrator original como alternativa para os relatórios antigos.

- `src/payroll.js`: motor financeiro puro e parâmetros versionados no histórico.
- `src/pdf.js`: extração de texto e reconhecimento de ponto/recibo, sem guardar identificação pessoal.
- `src/storage.js`: migração de preferências anteriores, histórico e validação de backups.
- `src/app.js`: interface, importação, comparação, exportação e instalação.
- `sw.js`: modelo de cache com lista explícita; o build injeta hash e arquivos públicos.
- `tests/`: cenários sintéticos, sem documentos reais ou valores pessoais.

Os documentos reais usados em conferência devem permanecer **fora do repositório**, inclusive relatórios privados de validação e screenshots com valores pessoais.

## Publicação PWA

Hospede `dist/` por HTTPS. O manifesto usa URLs relativas e funciona na raiz ou em `/folhacerta/`. O Service Worker prepara o app para uso offline e avisa quando uma atualização está disponível. No Chrome Android, use **Instalar app** ou o menu **Adicionar à tela inicial**.

O workflow `validate-package.yml` produz o pacote web e o APK. Para GitHub Pages, ative Pages com GitHub Actions e publique `dist/` por `actions/upload-pages-artifact` e `actions/deploy-pages`. A conexão GitHub usada para edição pode não ter permissão administrativa para ativar Pages; outra hospedagem HTTPS pode servir o mesmo build.

## APK Android

O wrapper nativo usa WebView com os mesmos arquivos locais. Não pede permissão de internet nem acesso amplo ao armazenamento. Seleção de PDF e exportação usam o seletor de documentos do Android.

O GitHub Actions usa JDK e Android SDK oficiais (AAPT2, D8, zipalign e apksigner), verifica assinatura/alinhamento/manifesto e publica APK de testes e SHA-256 em Releases. É uma assinatura de desenvolvimento, não uma distribuição pela Play Store. O cache preserva a chave de teste quando disponível; se ela mudar, pode ser necessário exportar backup e reinstalar.

Requisitos de compilação manual: JDK 17, Android SDK Platform 35 e Build Tools 35.0.0; depois do build web, execute `bash scripts/build-android.sh`. Requer Android 9+ com Android System WebView atualizado. Assinatura válida não equivale a validação em aparelho físico.

## Privacidade

Nenhum PDF, texto bruto, nome, CPF ou dado bancário é persistido pelo importador. Só horas, valores, competências e observações digitadas são guardados no dispositivo. Não há servidor de folha, analytics nem upload de documentos. O site e o APK possuem armazenamentos separados, transferíveis por backup JSON. Backups contêm informações financeiras e devem ser guardados de forma privada.
