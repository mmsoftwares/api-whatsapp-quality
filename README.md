# FireAPI / Bot WhatsApp

API em FastAPI e bot WhatsApp via Twilio para consultas e cadastro de documentos.
Consulte `documentacao.md` para detalhes dos endpoints REST.

## Instalação

```bash
npm install
```

No Windows, garanta que a `fbclient.dll` esteja acessível (PATH) ou defina:

```cmd
set FIREBIRD_CLIENTLIB=C:\\Firebird\\fbclient.dll
```

## Seeds do Firebird

Scripts idempotentes para popular o menu e configurar auto incremento.

```bash
# Firebird 2.5
npm run seed:fb25

# Firebird 5.0
npm run seed:fb50
```

## Execução do bot

```bash
npm run bot:start
```

## Teste rápido

1. Envie `menu` para o número WhatsApp configurado.
2. Envie `1` para entrar em "Detalhes da entrega".
3. Envie `123` (exemplo de NOMOVTRA).

Após a resposta com os dados da entrega, o menu principal é mostrado novamente.

## Charsets

Bases antigas podem usar `WIN1252`. Para bases modernas utilize `UTF8` e
configure `FIREBIRD_CHARSET` conforme necessário.
