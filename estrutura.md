# Estrutura do Projeto

## Raiz
- `main.py`: inicia a API FastAPI com todas as rotas.
- `config.py`: carrega variáveis de ambiente e configurações.
- `documentacao.md`: documentação dos endpoints e variáveis.
- `requirements.txt` / `Dockerfile`: dependências e containerização.
- Arquivos SQL (`insert_menu_fb25.sql`, `insert_menu_fb50.sql`, etc.): sementes de menu.

## `routes/`
Endpoints FastAPI responsáveis pelas consultas e operações em banco para cada cliente.
- `entregas.py`, `cte.py`, `nfe.py`, `precadastro.py`, `cadastroveiculo.py`, `confirmar.py`, `upload.py`.
- `novas_tables.sql`: script de criação de tabelas do master.

## `twilio/`
Integração com WhatsApp/Twilio em Node.js.
- `src/routes/whatsapp/`: fluxo de mensagens e menus dinâmicos.
- `src/services/`: acesso a bancos Firebird, chamadas à API Python e utilidades.
- `src/utils/`: logger e helpers.

## `functions/`
Funções auxiliares em Python para extração de texto, upload ao Drive e gravação no banco.

## `scripts/`
Scripts de apoio para gerar menus e executar SQL de seed.

## `python/utils/`
`menu_logic.py`: lógica de montagem de menus em Python.

## Arquivos não utilizados na lógica dinâmica
- `arc.txt`, `menu_seed_usage.txt`.
- Cópias de SQL (`insert_menu_fb25 copy.sql`, `insert_menu_fb50 copy.sql`).
- Scripts avulsos (`gerar_token.py`, `save_precad_pessoa.py`).
- Diretório `node_modules` (dependências).
