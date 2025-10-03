# Documentação da API

## Endpoints

### POST /webhook
Recebe mensagens do WhatsApp e responde com o menu configurado para cada cliente.

**Payload**
- `to`: número do WhatsApp do cliente configurado
- `from`: número do usuário que enviou a mensagem
- `body`: texto da mensagem enviada pelo usuário

**Comportamento**
- Identifica o cliente pelo campo `to`.
- Carrega o menu e navega entre opções utilizando os registros das tabelas `menus` e `menu_opcoes`.
- Registra cada interação (mensagem do usuário e resposta do bot) na tabela `conversas` do banco do cliente.

### POST /upload
Envia um arquivo (imagem JPG/PNG ou PDF) para extração de dados.
Aceita o parâmetro de query `tipo` para definir o template utilizado:
`pessoa` (padrão), `veiculo` ou `cte`.

**Resposta de Sucesso**
```json
{
  "status": "processado",
  "dados": {
    "chave_acesso": "...",
    "data_emissao": "AAAA-MM-DD",
    "cnpj_emitente": "..."
  },
  "chave": "<44 dígitos>" // retornado quando tipo=cte
}
```

### POST /confirmar
Confirma os dados retornados pelo `/upload`.

Requer o cabeçalho `x-whatsapp-number` com o número do bot para resolver o banco do cliente.
Campos enviados:
- `chave_acesso` – string
- `confirma` – boolean
- `dados` – JSON com as chaves extraídas
- `temp_path` – caminho temporário do arquivo enviado no `/upload`

Se `confirma` for `true`, o serviço salva os dados no banco Firebird e envia o arquivo para o Google Drive.

**Resposta de Sucesso**
```json
{
  "status": "salvo",
  "mensagem": "Documento confirmado e salvo no banco e Google Drive."
}
```

### POST /precadastro
Recebe dados extraídos da CNH e salva em `TABPRECAD_PESSOA`.
Aceita também um `link` opcional para download do documento enviado.

Requer o cabeçalho `x-whatsapp-number` com o número do bot para determinar o banco do cliente.

**Exemplo de Requisição**
```json
{
  "dados": {
    "NOME": "JOÃO DA SILVA",
    "CPF": "12345678901"
  },
  "link": "https://exemplo.com/arquivo.pdf"
}
```

**Resposta de Sucesso**
```json
{
  "status": "salvo"
}
```

### POST /cadastroveiculo
Recebe dados do documento do veículo e salva em `TABPRECAD_VEICULO`.

Requer o cabeçalho `x-whatsapp-number` com o número do bot para determinar o banco do cliente.

**Exemplo de Requisição**
```json
{
  "dados": {
    "PLACA": "ABC1D23",
    "RENAVAN": "123456789"
  },
  "link": "https://exemplo.com/doc_veiculo.pdf"
}
```

**Resposta de Sucesso**
```json
{
  "status": "salvo"
}
```

### POST /ocorrencia
Registra uma ocorrência vinculada a um pedido utilizando a lógica do `ocoService.js`.

Requer o cabeçalho `x-whatsapp-number` para identificar o banco do cliente.

**Exemplo de Requisição**
```json
{
  "nomovtra": 12345,
  "cpf": "12345678901",
  "texto": "Entrega atrasada"
}
```

**Resposta de Sucesso**
```json
{
  "status": "ok",
  "nomovtra": 12345,
  "noitem": 1
}
```

### GET /entregas/{numero}
Retorna os detalhes da entrega informada. Necessita o parâmetro de query `cpf` para
garantir que o motorista consultado corresponda ao pedido. O serviço identifica o
cliente automaticamente a partir do número do bot informado no header `X-WHATSAPP-NUMBER`
e busca as credenciais do banco na base mestre.

**Resposta de Sucesso**
```json
{
  "status": "ok",
  "entrega": {
    "numero": "12345",
    "cliente_nome": "...",
    "motorista_nome": "..."
  }
}
```

### GET /cte/{chave}
Consulta dados de um CT-e pela chave de 44 dígitos. Requer o parâmetro de query `cpf`
para validar se o motorista está autorizado e o cabeçalho `x-whatsapp-number` para
definir o banco do cliente.

**Resposta de Sucesso**
```json
{
  "status": "ok",
  "cte": {
    "statuscte": "...",
    "dataemi": "DD/MM/AAAA",
    "totalpeso": "..."
  }
}
```

### POST /webhooks/whatsapp
Recebe mensagens enviadas pelo WhatsApp via Twilio. O corpo é recebido em
`application/x-www-form-urlencoded` e as respostas variam conforme o conteúdo
do usuário (texto, imagem ou PDF). Esse endpoint é utilizado internamente pela
filtragem e extração de dados dos documentos enviados pelo chat.

## Variáveis de Ambiente
- `OPENAI_KEY`
- `FIREBIRD_HOST`
- `FIREBIRD_DATABASE`
- `FIREBIRD_USER`
- `FIREBIRD_PASSWORD`
- `FIREBIRD_CHARSET` – charset do banco (ex.: WIN1252 ou UTF8)
- `GOOGLE_DRIVE_TOKEN` – caminho para credenciais do serviço
- `GOOGLE_DRIVE_FOLDER` – id da pasta destino no Drive
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM`
- `BASE_URL` – URL pública usada para validar a assinatura da Twilio
- `CONCURRENCY` – número de mensagens processadas em paralelo na fila
- `MASTER_DB_URL` – string de conexão para o banco mestre que guarda os clientes

Notas de configuracoes do MASTER:
- Preferir variaveis `FB_MASTER_*` para o banco mestre (host, database, user, password).
- Caso ausentes, o sistema tenta utilizar `FIREBIRD_*` como legado.
- Bibliotecas cliente do Firebird podem ser definidas por `FBCLIENT_DLL`, `FBCLIENT_DLL_25` (2.5) e `FBCLIENT_DLL_50` (5.0).
- `FB_ENCODING_MASTER` e `FB_ENCODING_TENANT` controlam o encoding (ex.: `win1252`).

## Docker
A aplicação pode ser executada via Docker:
```bash
docker build -t fireapi .
docker run -p 8000:8000 --env-file .env fireapi
```

## Logs
A aplicação utiliza o módulo `logging` do Python. As ações principais são
registradas no console, facilitando o acompanhamento do processamento dos
arquivos.

## Integração com WhatsApp
A integração com o WhatsApp é feita por meio da Twilio. O endpoint
`/webhooks/whatsapp` recebe textos e mídias dos usuários, valida a assinatura
da requisição e adiciona o processamento a uma fila controlada pela variável
`CONCURRENCY`. As respostas são enviadas de forma automática conforme as
regras do fluxo de atendimento.
