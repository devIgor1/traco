# Traço — Assinador de PDF

Um editor simples para preencher e assinar PDFs inteiramente no navegador. O documento, os dados preenchidos e a assinatura não são enviados para nenhum servidor.

## Como abrir

```bash
npm install
npm run dev
```

Depois, acesse o endereço local mostrado no terminal (normalmente `http://localhost:5173`).

## Como usar

1. Escolha ou arraste um PDF.
2. Clique em **Preparar vários** e digite um preenchimento por linha. Todos eles ficarão disponíveis na bandeja.
3. Arraste cada dado da bandeja até o campo correspondente no PDF. No celular, você também pode tocar no dado para posicioná-lo automaticamente.
4. Use **Texto**, **Marcar** ou **Inserir X** quando quiser adicionar um item avulso.
5. Arraste cada item pela página e use a alça colorida para redimensionar. Dê dois cliques em um texto para editá-lo.
6. Para repetir um preenchimento, selecione-o e use o botão **Duplicar** ou o atalho `Ctrl+D`.
7. Se precisar assinar, clique em **Criar assinatura** e desenhe com mouse, trackpad ou toque.
8. Repita em outras páginas, se necessário, e clique em **Baixar PDF final**.

## Versão de produção

```bash
npm run build
```

Os arquivos prontos serão gerados na pasta `dist`.

> A assinatura adicionada é visual e manuscrita. Ela não equivale a um certificado digital ICP-Brasil.
