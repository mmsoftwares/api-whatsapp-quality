import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

OPENAI_KEY = os.getenv("OPENAI_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
FIREBIRD_HOST = os.getenv("FIREBIRD_HOST", "192.168.1.252")
FIREBIRD_DATABASE = os.getenv("FIREBIRD_DATABASE")
FIREBIRD_USER = os.getenv("FIREBIRD_USER", "SYSDBA")
FIREBIRD_PASSWORD = os.getenv("FIREBIRD_PASSWORD", "masterkey")
GOOGLE_DRIVE_TOKEN = os.getenv("GOOGLE_DRIVE_TOKEN")
GOOGLE_DRIVE_FOLDER = os.getenv("GOOGLE_DRIVE_FOLDER", "root")
# Caminho/alias visto pelo SERVIDOR Firebird (não pelo Windows local).
# Ideal: defina no .env MASTER_DB_URL=SISERV ou MASTER_DB_URL=/home/bdmm/Siserv/Database/DATABASE.GDB
MASTER_DB_URL = os.getenv("MASTER_DB_URL", "/home/bdmm/Siserv/Database/DATABASE.GDB")

UPLOAD_DIR = Path(r"C:/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)  # Garante que a pasta exista
