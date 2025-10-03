SET AUTODDL OFF;
COMMIT;
BEGIN;
DELETE FROM MENU_OPCOES WHERE ID IN (1,2,3,4,5);
DELETE FROM MENUS WHERE ID IN (1);
INSERT INTO MENUS (ID, CLIENTE_ID, TITULO, ATIVO) VALUES (1, 1, '📋 Escolha uma opção digitando o número:', 1);
INSERT INTO MENU_OPCOES (ID, MENU_ID, CHAVE_PAI, OPCAO, TEXTO, PROXIMA_CHAVE, ORDEM) VALUES (1, 1, 'root', '1', 'ðŸ§¾ Informe o *nÃºmero da entrega* (apenas nÃºmeros).', NULL, 10);
INSERT INTO MENU_OPCOES (ID, MENU_ID, CHAVE_PAI, OPCAO, TEXTO, PROXIMA_CHAVE, ORDEM) VALUES (2, 1, 'root', '2', 'ðŸ§¾ Informe o nÃºmero do pedido, ou envie o CTE', NULL, 20);
INSERT INTO MENU_OPCOES (ID, MENU_ID, CHAVE_PAI, OPCAO, TEXTO, PROXIMA_CHAVE, ORDEM) VALUES (3, 1, 'root', '3', 'ðŸ“„ *Consulta de CT-e*
Envie a *imagem* ou *PDF* do CT-e, ou cole a *chave de 44 dÃ­gitos* do CT-e.
Para sair, digite *CANCELAR*.', NULL, 30);
INSERT INTO MENU_OPCOES (ID, MENU_ID, CHAVE_PAI, OPCAO, TEXTO, PROXIMA_CHAVE, ORDEM) VALUES (4, 1, 'root', '4', 'ðŸªª *Cadastro de motorista*
Envie a foto da *frente* e/ou *verso* da identidade/CNH (pode enviar em mensagens separadas). Quando terminar, digite *CONFIRMAR*. Para cancelar, *CANCELAR*.', NULL, 40);
INSERT INTO MENU_OPCOES (ID, MENU_ID, CHAVE_PAI, OPCAO, TEXTO, PROXIMA_CHAVE, ORDEM) VALUES (5, 1, 'root', '5', 'ðŸšš *Cadastro de veÃ­culo*
Envie a foto ou PDF do documento do veÃ­culo. Pode enviar em mensagens separadas. Quando terminar, digite *CONFIRMAR*. Para cancelar, *CANCELAR*.', NULL, 50);
COMMIT;
