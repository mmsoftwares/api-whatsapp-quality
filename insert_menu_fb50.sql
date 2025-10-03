SET AUTODDL OFF;
COMMIT;
BEGIN;
MERGE INTO MENUS m
USING (SELECT 1 AS ID FROM RDB$DATABASE) src
ON (m.ID = src.ID)
WHEN MATCHED THEN UPDATE SET CLIENTE_ID = 1, TITULO = '📋 Escolha uma opção digitando o número:', ATIVO = 1
WHEN NOT MATCHED THEN INSERT (ID, CLIENTE_ID, TITULO, ATIVO) VALUES (1, 1, '📋 Escolha uma opção digitando o número:', 1);
MERGE INTO MENU_OPCOES m
USING (SELECT 1 AS ID FROM RDB$DATABASE) src
ON (m.ID = src.ID)
WHEN MATCHED THEN UPDATE SET MENU_ID=1, CHAVE_PAI='root', OPCAO='1', TEXTO='ðŸ§¾ Informe o *nÃºmero da entrega* (apenas nÃºmeros).', PROXIMA_CHAVE=NULL, ORDEM=10
WHEN NOT MATCHED THEN INSERT (ID, MENU_ID, CHAVE_PAI, OPCAO, TEXTO, PROXIMA_CHAVE, ORDEM)
VALUES (1, 1, 'root', '1', 'ðŸ§¾ Informe o *nÃºmero da entrega* (apenas nÃºmeros).', NULL, 10);
MERGE INTO MENU_OPCOES m
USING (SELECT 2 AS ID FROM RDB$DATABASE) src
ON (m.ID = src.ID)
WHEN MATCHED THEN UPDATE SET MENU_ID=1, CHAVE_PAI='root', OPCAO='2', TEXTO='ðŸ§¾ Informe o nÃºmero do pedido, ou envie o CTE', PROXIMA_CHAVE=NULL, ORDEM=20
WHEN NOT MATCHED THEN INSERT (ID, MENU_ID, CHAVE_PAI, OPCAO, TEXTO, PROXIMA_CHAVE, ORDEM)
VALUES (2, 1, 'root', '2', 'ðŸ§¾ Informe o nÃºmero do pedido, ou envie o CTE', NULL, 20);
MERGE INTO MENU_OPCOES m
USING (SELECT 3 AS ID FROM RDB$DATABASE) src
ON (m.ID = src.ID)
WHEN MATCHED THEN UPDATE SET MENU_ID=1, CHAVE_PAI='root', OPCAO='3', TEXTO='ðŸ“„ *Consulta de CT-e*
Envie a *imagem* ou *PDF* do CT-e, ou cole a *chave de 44 dÃ­gitos* do CT-e.
Para sair, digite *CANCELAR*.', PROXIMA_CHAVE=NULL, ORDEM=30
WHEN NOT MATCHED THEN INSERT (ID, MENU_ID, CHAVE_PAI, OPCAO, TEXTO, PROXIMA_CHAVE, ORDEM)
VALUES (3, 1, 'root', '3', 'ðŸ“„ *Consulta de CT-e*
Envie a *imagem* ou *PDF* do CT-e, ou cole a *chave de 44 dÃ­gitos* do CT-e.
Para sair, digite *CANCELAR*.', NULL, 30);
MERGE INTO MENU_OPCOES m
USING (SELECT 4 AS ID FROM RDB$DATABASE) src
ON (m.ID = src.ID)
WHEN MATCHED THEN UPDATE SET MENU_ID=1, CHAVE_PAI='root', OPCAO='4', TEXTO='ðŸªª *Cadastro de motorista*
Envie a foto da *frente* e/ou *verso* da identidade/CNH (pode enviar em mensagens separadas). Quando terminar, digite *CONFIRMAR*. Para cancelar, *CANCELAR*.', PROXIMA_CHAVE=NULL, ORDEM=40
WHEN NOT MATCHED THEN INSERT (ID, MENU_ID, CHAVE_PAI, OPCAO, TEXTO, PROXIMA_CHAVE, ORDEM)
VALUES (4, 1, 'root', '4', 'ðŸªª *Cadastro de motorista*
Envie a foto da *frente* e/ou *verso* da identidade/CNH (pode enviar em mensagens separadas). Quando terminar, digite *CONFIRMAR*. Para cancelar, *CANCELAR*.', NULL, 40);
MERGE INTO MENU_OPCOES m
USING (SELECT 5 AS ID FROM RDB$DATABASE) src
ON (m.ID = src.ID)
WHEN MATCHED THEN UPDATE SET MENU_ID=1, CHAVE_PAI='root', OPCAO='5', TEXTO='ðŸšš *Cadastro de veÃ­culo*
Envie a foto ou PDF do documento do veÃ­culo. Pode enviar em mensagens separadas. Quando terminar, digite *CONFIRMAR*. Para cancelar, *CANCELAR*.', PROXIMA_CHAVE=NULL, ORDEM=50
WHEN NOT MATCHED THEN INSERT (ID, MENU_ID, CHAVE_PAI, OPCAO, TEXTO, PROXIMA_CHAVE, ORDEM)
VALUES (5, 1, 'root', '5', 'ðŸšš *Cadastro de veÃ­culo*
Envie a foto ou PDF do documento do veÃ­culo. Pode enviar em mensagens separadas. Quando terminar, digite *CONFIRMAR*. Para cancelar, *CANCELAR*.', NULL, 50);
COMMIT;
