# 🥗 IA Nutri

PWA para quem está de dieta: tire uma foto do prato e a IA estima **calorias, proteína, carboidrato e gordura** de cada alimento, com dicas para deixar a refeição mais fit.

- Visão computacional com **Claude (Anthropic)**, orientada como nutricionista esportivo
- Valores de referência da **Tabela TACO / TBCA** (alimentos brasileiros) e USDA
- Considera óleo e molhos "escondidos" e mostra uma faixa provável de kcal
- Histórico por **dia, semana e mês**, com gráfico de calorias vs. meta, médias e dias dentro da meta (salvo no próprio celular)
- Instalável na tela inicial (Android e iPhone)

## Rodar localmente

```bash
npm install
cp .env.example .env   # coloque sua chave da API em ANTHROPIC_API_KEY
npm start              # http://localhost:3000
```

Pegue a chave em https://console.anthropic.com → API Keys.

## Usar no celular

A câmera e a instalação como app exigem **HTTPS**, então o ideal é publicar o servidor. Qualquer host Node serve, por exemplo o [Render](https://render.com):

1. New → Web Service → conecte este repositório
2. Build: `npm install` · Start: `npm start`
3. Em *Environment*, adicione `ANTHROPIC_API_KEY`
4. Abra a URL no celular → **Adicionar à tela inicial**

## Estrutura

```
server.js           servidor Node (arquivos estáticos + POST /api/analyze → Claude)
public/index.html   interface
public/app.js       câmera, redimensionamento da foto, resultado, histórico
public/sw.js        service worker (PWA)
```

> As estimativas são aproximadas (±15–25% é normal para análise por foto). Informar pesos no campo de detalhes aumenta muito a precisão.
