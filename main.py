"""API principal para processamento de notas fiscais."""

import logging
from fastapi import FastAPI

import config  # noqa: F401  # carrega variáveis de ambiente e diretórios
from routes.upload import router as upload_router
from routes.confirmar import router as confirmar_router
from routes.entregas import router as entregas_router
from routes.precadastro import router as precadastro_router
from routes.cadastroveiculo import router as cadastroveiculo_router
from routes.cte import router as cte_router
from routes.ocorrencia import router as ocorrencia_router


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

app = FastAPI()
app.include_router(upload_router)
app.include_router(confirmar_router)
app.include_router(entregas_router)
app.include_router(precadastro_router)
app.include_router(cadastroveiculo_router)
app.include_router(cte_router)
app.include_router(ocorrencia_router)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
