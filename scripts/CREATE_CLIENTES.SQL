CREATE TABLE TABPRECAD_PESSOA (
    NOPRECADPESSOA   INTEGER NOT NULL,
    DATAREG          DATE,
    DATAALT          DATE,
    NOME             VARCHAR(150),
    CNH_DATAEMISSAO  DATE,
    CNH_DATA1CNH     DATE,
    CNH_DATAVCTO     DATE,
    DATANASC         DATE,
    CIDADENASC       VARCHAR(50),
    UFEMISSOR        VARCHAR(10),
    ORGAOEMISSOR     VARCHAR(20),
    RG               VARCHAR(20),
    CPF              VARCHAR(20),
    CNH_REGISTRO     VARCHAR(20),
    CNH_CAT          VARCHAR(10),
    NACIONALIDADE    VARCHAR(20),
    FIL_PAI          VARCHAR(50),
    FIL_MAE          VARCHAR(50),
    CNH_PROTOCOLO    VARCHAR(20),
    CNH_DATAEXPEDICAO DATE,
    UFEXPEDICAO      VARCHAR(10),
    CNH_SEGURO       VARCHAR(20),
    LINK             VARCHAR(500),

    CONSTRAINT PK_TABLEPRECAD_PESSOA PRIMARY KEY (NOPRECADPESSOA)
);
/* PESSOA TRIGGER */

CREATE OR ALTER TRIGGER TABPRECAD_PESSOA_BI FOR TABPRECAD_PESSOA
ACTIVE BEFORE INSERT POSITION 0
as
begin
  if (new.noprecadpessoa is null) then
    new.noprecadpessoa = gen_id(gen_noprecadpessoa,1);
end
^


SET TERM ; ^


/* PESSOA GENERATOR */
CREATE SEQUENCE GEN_NOPRECADPESSOA;


/* TABLE VEICULO */
CREATE TABLE TABPRECAD_VEICULO (
    NOPRECADVEICULO  INTEGER NOT NULL,
    DATAREG          DATE,
    DATAALT          DATE,
    PLACA            VARCHAR(10),
    RENAVAN          VARCHAR(30),
    ANOEXERCICIO     INTEGER,
    ANOMODELO        INTEGER,
    ANOFABRICACAO    INTEGER,
    CATEGORIA        VARCHAR(100),
    CAPACIDADE       VARCHAR(50),
    POTENCIA         VARCHAR(50),
    PESOBRUTO        VARCHAR(50),
    MOTOR            VARCHAR(50),
    CMT              VARCHAR(50),
    EIXOS            INTEGER,
    LOTACAO          VARCHAR(50),
    CARROCERIA       VARCHAR(50),
    NOME             VARCHAR(150),
    CPFCNPJ          VARCHAR(20),
    LOCALIDADE       VARCHAR(50),
    DATA_LANC        DATE,              -- no print parece "DATA_LANC"
    CODIGOCLA        VARCHAR(50),
    CAT              VARCHAR(50),
    MARCA_MODELO     VARCHAR(50),
    ESPECIE_TIPO     VARCHAR(50),
    PLACAANTERIOR    VARCHAR(10),
    CHASSI           VARCHAR(50),
    COR              VARCHAR(50),
    COMBUSTIVEL      VARCHAR(50),
    OBS              VARCHAR(500),
    LINK             VARCHAR(500),

    CONSTRAINT PK_TABPRECAD_VEICULO PRIMARY KEY (NOPRECADVEICULO)
);

/* VEICULO TRIGGER */
CREATE OR ALTER TRIGGER TABPRECAD_VEICULO_BI FOR TABPRECAD_VEICULO
ACTIVE BEFORE INSERT POSITION 0
as
begin
  if (new.noprecadveiculo is null) then
    new.noprecadveiculo = gen_id(gen_noprecadveiculo,1);
end
^


SET TERM ; ^

/* VEICULO GENERATOR */

CREATE SEQUENCE GEN_NOPRECADVEICULO;



/* ANTT TABLE */

CREATE OR ALTER TRIGGER TABPRECAD_ANTT_BI FOR TABPRECAD_ANTT
ACTIVE BEFORE INSERT POSITION 0
as
begin
  if (new.noprecadantt is null) then
    new.noprecadantt = gen_id(gen_noprecadantt,1);
end
^


SET TERM ; ^


/* ANTT TRIGGER */

CREATE OR ALTER TRIGGER TABPRECAD_ANTT_BI FOR TABPRECAD_ANTT
ACTIVE BEFORE INSERT POSITION 0
as
begin
  if (new.noprecadantt is null) then
    new.noprecadantt = gen_id(gen_noprecadantt,1);
end
^


SET TERM ; ^

/* ANTT GENERATOR */

CREATE SEQUENCE GEN_NOPRECADANTT;