"""Função para enviar arquivos ao Google Drive (robusta e tolerante a None)."""

import json
import time
import logging
import mimetypes
from pathlib import Path
from typing import Optional

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

from config import GOOGLE_DRIVE_TOKEN

DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"]
RETRIABLE_STATUS = {429, 500, 502, 503, 504}


def _load_credentials(token_path: str) -> Credentials:
    """Carrega e renova credenciais do Google Drive."""
    with open(token_path, "r", encoding="utf-8") as fh:
        creds_data = json.load(fh)

    creds = Credentials.from_authorized_user_info(creds_data, DRIVE_SCOPES)

    if not creds.valid and creds.refresh_token:
        creds.refresh(Request())
        with open(token_path, "w", encoding="utf-8") as out:
            out.write(creds.to_json())

    return creds


def upload_to_drive(
    file_path: Optional[str],
    drive_folder_id: str,
) -> Optional[str]:
    """Realiza o upload de um arquivo para o Google Drive.

    :param file_path: caminho do arquivo local. Se None/vazio, retorna None.
    :param drive_folder_id: ID da pasta de destino no Drive.
    :return: ID do arquivo criado no Drive ou None.
    :raises: FileNotFoundError e HttpError para falhas do Drive.
    """
    if not file_path:
        logging.info(
            "upload_to_drive: file_path vazio/None — ignorando upload."
        )
        return None

    abs_path = Path(file_path).resolve()
    if not abs_path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {abs_path}")

    logging.info("Iniciando upload para o Drive: %s", abs_path)

    mime_type, _ = mimetypes.guess_type(abs_path.as_posix())
    if not mime_type:
        mime_type = (
            "application/pdf"
            if abs_path.suffix.lower() == ".pdf"
            else "application/octet-stream"
        )

    creds = _load_credentials(GOOGLE_DRIVE_TOKEN)
    service = build("drive", "v3", credentials=creds, cache_discovery=False)

    file_metadata = {"name": abs_path.name, "parents": [drive_folder_id]}

    media = MediaFileUpload(
        abs_path.as_posix(),
        mimetype=mime_type,
        resumable=True,  # upload resumível
        chunksize=5 * 1024 * 1024,  # 5MB
    )

    attempt = 0
    max_attempts = 5
    while True:
        try:
            request = service.files().create(
                body=file_metadata,
                media_body=media,
                fields="id",
            )
            response = None
            while response is None:
                status, response = request.next_chunk()
                if status:
                    logging.info(
                        "Upload em andamento: %.1f%%",
                        status.progress() * 100.0,
                    )

            file_id = response.get("id")
            logging.info("Upload concluído. ID no Drive: %s", file_id)
            return file_id

        except HttpError as e:
            status = (
                getattr(e, "status_code", None)
                or getattr(e, "resp", {}).status
                if hasattr(e, "resp")
                else None
            )
            if status in RETRIABLE_STATUS and attempt < max_attempts - 1:
                attempt += 1
                sleep_for = 2 ** attempt
                logging.warning(
                    "Erro %s no upload (tentativa %d/%d). "
                    "Retentando em %ds...",
                    status,
                    attempt,
                    max_attempts,
                    sleep_for,
                )
                time.sleep(sleep_for)
                continue
            logging.error("Falha no upload para o Drive: %s", e)
            raise

        except Exception as e:
            if attempt < max_attempts - 1:
                attempt += 1
                sleep_for = 2 ** attempt
                logging.warning(
                    "Erro inesperado no upload (tentativa %d/%d): %s. "
                    "Retentando em %ds...",
                    attempt,
                    max_attempts,
                    e,
                    sleep_for,
                )
                time.sleep(sleep_for)
                continue
            logging.exception("Falha definitiva no upload.")
            raise
