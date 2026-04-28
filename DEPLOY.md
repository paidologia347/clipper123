# Deploy YT Short Clipper ke Azure App Service

Panduan deploy web app clipper123 ke Azure App Service menggunakan Docker container.

## Prasyarat

- **Azure for Students** account ($100 credit gratis) atau Azure subscription aktif
- **GitHub account** (untuk CI/CD auto-deploy)
- **Azure CLI** terinstall (`curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash`)

## Opsi 1: Deploy Manual via Azure CLI (Tercepat)

### 1. Login ke Azure

```bash
az login
```

### 2. Buat Resource Group

```bash
az group create --name clipper123-rg --location southeastasia
```

### 3. Buat App Service Plan (Linux, B1 tier)

```bash
az appservice plan create \
  --name clipper123-plan \
  --resource-group clipper123-rg \
  --sku B1 \
  --is-linux
```

> **Estimasi biaya B1**: ~$13/bulan (tercover oleh $100 student credit untuk ~7 bulan)

### 4. Buat Web App dengan Docker

```bash
az webapp create \
  --name clipper123 \
  --resource-group clipper123-rg \
  --plan clipper123-plan \
  --runtime "PYTHON:3.11"
```

### 5. Deploy dari GitHub

```bash
az webapp deployment source config \
  --name clipper123 \
  --resource-group clipper123-rg \
  --repo-url https://github.com/paidologia347/clipper123 \
  --branch base \
  --manual-integration
```

### 6. Konfigurasi Startup Command

```bash
az webapp config set \
  --name clipper123 \
  --resource-group clipper123-rg \
  --startup-file "gunicorn --worker-class eventlet -w 1 --bind 0.0.0.0:8000 --timeout 300 web_app:app"
```

### 7. Enable WebSocket

```bash
az webapp config set \
  --name clipper123 \
  --resource-group clipper123-rg \
  --web-sockets-enabled true
```

### 8. Set Environment Variables

```bash
az webapp config appsettings set \
  --name clipper123 \
  --resource-group clipper123-rg \
  --settings \
    PORT=8000 \
    WEBSITES_PORT=8000
```

App akan tersedia di: `https://clipper123.azurewebsites.net`

---

## Opsi 2: Deploy dengan Docker Container (Rekomendasi)

Cocok jika perlu FFmpeg + Deno (untuk video processing lengkap).

### 1. Buat Azure Container Registry (ACR)

```bash
az acr create \
  --name clipper123acr \
  --resource-group clipper123-rg \
  --sku Basic \
  --admin-enabled true
```

### 2. Build & Push Docker Image

```bash
# Login ke ACR
az acr login --name clipper123acr

# Build & push
az acr build \
  --registry clipper123acr \
  --image clipper123:latest .
```

### 3. Buat Web App dari Container

```bash
az webapp create \
  --name clipper123 \
  --resource-group clipper123-rg \
  --plan clipper123-plan \
  --deployment-container-image-name clipper123acr.azurecr.io/clipper123:latest
```

### 4. Konfigurasi ACR credentials

```bash
ACR_PASSWORD=$(az acr credential show --name clipper123acr --query "passwords[0].value" -o tsv)

az webapp config container set \
  --name clipper123 \
  --resource-group clipper123-rg \
  --container-image-name clipper123acr.azurecr.io/clipper123:latest \
  --container-registry-url https://clipper123acr.azurecr.io \
  --container-registry-user clipper123acr \
  --container-registry-password $ACR_PASSWORD
```

### 5. Enable WebSocket & Set Port

```bash
az webapp config set \
  --name clipper123 \
  --resource-group clipper123-rg \
  --web-sockets-enabled true

az webapp config appsettings set \
  --name clipper123 \
  --resource-group clipper123-rg \
  --settings \
    WEBSITES_PORT=8000
```

---

## Opsi 3: Auto-Deploy via GitHub Actions

File workflow sudah tersedia di `.github/workflows/azure-deploy.yml`.

### Setup GitHub Secrets

Tambahkan secrets berikut di repo GitHub (Settings > Secrets > Actions):

| Secret Name | Cara Mendapatkan |
|------------|------------------|
| `AZURE_WEBAPP_PUBLISH_PROFILE` | Azure Portal > App Service > Download publish profile |
| `ACR_LOGIN_SERVER` | `clipper123acr.azurecr.io` |
| `ACR_USERNAME` | `az acr credential show --name clipper123acr --query username -o tsv` |
| `ACR_PASSWORD` | `az acr credential show --name clipper123acr --query "passwords[0].value" -o tsv` |

Setelah secrets dikonfigurasi, setiap push ke branch `base` akan otomatis deploy ke Azure.

---

## Konfigurasi AI Provider di Production

Setelah deploy, buka `https://clipper123.azurewebsites.net` dan konfigurasi:

1. Buka **Settings > AI API**
2. Set Base URL: `https://api.puter.com/puterai/openai/v1/`
3. Set API Key: Puter auth token Anda
4. Pilih model (contoh: `gpt-4.1-nano`)
5. Save

---

## Estimasi Biaya (Azure for Students)

| Layanan | Harga/bulan | Catatan |
|---------|-------------|---------|
| App Service B1 | ~$13 | Linux, 1 core, 1.75GB RAM |
| Container Registry Basic | ~$5 | Jika pakai Docker deploy |
| **Total** | **~$13-18** | Tercover $100 credit selama 5-7 bulan |

### Tips Hemat Credit
- Gunakan **Free tier (F1)** untuk testing ($0/bulan, tapi tanpa WebSocket & limited)
- Stop App Service saat tidak digunakan (tidak dihitung billing)
- Gunakan `az webapp stop` dan `az webapp start` untuk kontrol manual

---

## Troubleshooting

### WebSocket tidak connect
- Pastikan WebSocket enabled: `az webapp config set --web-sockets-enabled true`
- Cek ARR Affinity enabled di Azure Portal

### FFmpeg tidak ditemukan
- Gunakan Docker deployment (Opsi 2) yang sudah include FFmpeg
- Atau tambahkan custom startup script

### Timeout pada video processing
- B1 tier punya 1 core / 1.75GB RAM — cukup untuk video pendek
- Untuk video panjang (>30 menit), pertimbangkan upgrade ke B2/B3

### Logs
```bash
az webapp log tail --name clipper123 --resource-group clipper123-rg
```
