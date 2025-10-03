from google_auth_oauthlib.flow import InstalledAppFlow

# Escopo mínimo para enviar arquivos para o Drive
SCOPES = ["https://www.googleapis.com/auth/drive.file"]


def gerar_token() -> None:
    """Gera e salva um token de acesso para o Google Drive."""
    flow = InstalledAppFlow.from_client_secrets_file(
        "credentials.json",
        SCOPES,
    )
    creds = flow.run_local_server(port=0)

    with open("token.json", "w") as token:
        token.write(creds.to_json())

    print("✅ Token gerado e salvo em token.json")


if __name__ == "__main__":
    gerar_token()
