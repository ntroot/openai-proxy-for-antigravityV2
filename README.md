# 🚀 OpenAI Proxy for Antigravity

<div align="center">

**OpenAI-compatible gateway for Google's internal Antigravity API**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-Supported-blue)](https://www.docker.com/)
[![Zed](https://img.shields.io/badge/Zed-Compatible-purple)](https://zed.dev)

*Unlock the full power of Google's internal AI models in your favorite local tools.*

</div>

> [!WARNING]
> **EXPERIMENTAL PROJECT**: This project is currently a work-in-progress (test phase) and is NOT complete.
> At this time, **only Gemini 3 Pro is confirmed to be working**. Other models may fail or behave unexpectedly.

---

## 📖 Overview

**OpenAI Proxy for Antigravity** is a standalone local server that acts as a bridge between OpenAI-compatible clients (like [Zed IDE](https://zed.dev), VS Code, or Cursor) and Google's powerful **Antigravity API**.

### 🌟 Key Features

- **🔌 OpenAI Compatibility**: Drop-in replacement for any tool expecting an OpenAI-like API.
- **🔐 Dashboard & CLI OAuth Authentication**: Connect or remove Google accounts directly from the Admin Dashboard (`+ Add Account`) with no container restart required (includes manual callback URL fallback), or use the CLI wizard (`npm run auth`).
- **🎯 Dynamic Model Discovery & Per-Account Model Selection**: Live-fetches available models and real-time remaining quotas per account via `/v1internal:fetchAvailableModels`, lets you restrict which models each account can serve, filter models, and add custom model IDs.
- **🔄 Multi-Account Rotation**: Automatically rotates between multiple eligible Google accounts to maximize quota.
- **⚡ Smart Rate Limiting**: Detects 429 errors and switches accounts instantly.
- **📊 Admin Dashboard**: Web UI to manage accounts, configure per-account models & quotas, and monitor uptime, requests, and logs.
- **🐳 Windows & Docker Desktop Ready**: Automatically mounts `%APPDATA%\antigravity-proxy` on Windows (`~/.config/antigravity-proxy` on macOS/Linux) and exposes port `51121` for in-dashboard OAuth callbacks.

---

## 🤖 Supported Models

Models are **discovered dynamically** per connected account via Google's `/v1internal:fetchAvailableModels` endpoint (with automatic 5-minute caching and fallback to the default list when offline).

- **`GET /v1/models`** returns the live merged catalog of available models from your connected account(s).
- **`GET /admin/api/accounts/:index/models`** returns live models along with capabilities (`maxTokens`, `Thinking`, `Vision`) and **real-time remaining quota percentages** for each account.
- Per-account model restrictions configured in the Admin Dashboard are enforced automatically across all rotation strategies (`hybrid`, `sticky`, `round-robin`).

Default fallback models when no live account is queried yet:

| Model Name | Status | Capabilities |
|------------|--------|--------------|
| `antigravity-gemini-3-pro` | ✅ **Working** | 1M+ Context, 🛠️ Tools |
| `antigravity-claude-sonnet-4-5-thinking` | 🚧 *Testing* | Schema Validation Errors |
| `antigravity-claude-sonnet-4-5` | 🚧 *Testing* | Unstable |
| `antigravity-claude-opus-4-5-thinking` | 🚧 *Testing* | Schema Validation Errors |
| `antigravity-gemini-3-flash` | 🚧 *Testing* | Unstable |
| `gemini-2.5-pro` | 🚧 *Testing* | (via CLI quota) |

---

## ⚡ Quick Start

### Prerequisites
- Node.js 20+ (or Docker)
- A Google Account

### 📦 Local Installation

1.  **Clone and Install**
    ```bash
    npm install
    npm run build
    ```

2.  **Authenticate**
    Run the setup wizard to connect your Google account(s).
    ```bash
    npm run auth
    ```
    *This opens your browser for OAuth login. Credentials are saved locally to `~/.config/antigravity-proxy`.*

3.  **Start the Server**
    ```bash
    npm start
    ```
    The proxy is now running at `http://localhost:3000`.

### 🐳 Docker Installation

If you prefer keeping your host clean:

1.  **Build & Run with Docker Compose**
    ```bash
    docker compose -f docker/docker-compose.yml up -d --build
    ```
    *Exposes port `3000` (API + Admin Dashboard) and port `51121` (in-dashboard Google OAuth callback). Automatically mounts `%APPDATA%\antigravity-proxy` on Windows or `~/.config/antigravity-proxy` on macOS/Linux.*

2.  **Connect Google Account(s)**
    Open **[http://localhost:3000/admin](http://localhost:3000/admin)** and click **+ Add Account** to sign in with Google directly from the browser (no restart needed).  
    *(Alternatively, you can still authenticate via CLI with `npm run auth`.)*

    To view logs: `docker compose -f docker/docker-compose.yml logs -f`  
    To stop: `docker compose -f docker/docker-compose.yml down`

---

## 🛠️ Configuration

### Integration with Zed IDE

We provide a helper script to generate the exact JSON configuration needed for Zed.

1.  **Generate Config:**
    ```bash
    npm run generate-zed-config
    ```

2.  **Apply Settings:**
    Copy the output into your Zed `settings.json`:

    ```json
    {
      "language_models": {
        "openai_compatible": {
          "Antigravity": {
            "api_url": "http://localhost:3000/v1",
            "available_models": [
              {
                "name": "antigravity-claude-opus-4-5-thinking",
                "display_name": "Claude Opus 4.5 Thinking (Antigravity)",
                "max_tokens": 200000,
                "max_output_tokens": 64000,
                "capabilities": {
                  "tools": true,
                  "images": true,
                  "parallel_tool_calls": true,
                  "prompt_cache_key": true
                }
              },
              {
                "name": "antigravity-gemini-3-pro",
                "display_name": "Gemini 3 Pro (Antigravity)",
                "max_tokens": 1048576,
                "max_output_tokens": 65535,
                "capabilities": {
                  "tools": true,
                  "images": true,
                  "parallel_tool_calls": true,
                  "prompt_cache_key": true
                }
              }
            ]
          }
        }
      }
    }
    ```

3.  **Select Model:**
    Open the Assistant Panel in Zed, click the provider dropdown, and select **Antigravity**.

---

## 📊 Admin Dashboard

Visit **[http://localhost:3000/admin](http://localhost:3000/admin)** to access the dashboard.

- **Accounts Management**:
  - Click **+ Add Account** to connect new Google accounts via OAuth directly from the web UI (includes optional Google Cloud Project ID, initial model selection, and manual callback URL fallback).
  - Remove accounts with one click — changes take effect immediately without restarting the server.
- **Dynamic Per-Account Model Selection & Quotas**:
  - Click **Models** on any account row to view the live models available to that account from Antigravity API along with each model's **remaining quota percentage** and context limits.
  - Toggle **Allow all models** or select specific models per account, search/filter models, refresh live data (**↻ Refresh Models**), or add custom model IDs (**+ Add Custom**).
- **Status**: Check if your accounts are active or rate-limited.
- **Metrics**: View success rates and average response times.
- **Logs**: Inspect recent requests and responses for debugging.

### Admin API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/api/accounts` | List connected accounts, rate-limit status, and allowed models |
| `POST` | `/admin/api/accounts/oauth/start` | Start a Google OAuth flow and local callback server |
| `GET` | `/admin/api/accounts/oauth/status/:sessionId` | Poll OAuth session status |
| `POST` | `/admin/api/accounts/oauth/complete` | Complete OAuth manually using a callback URL or `code`/`state` |
| `GET` | `/admin/api/accounts/:index/models` | Fetch live models & quotas for a specific account (`?refresh=true` supported) |
| `PUT` | `/admin/api/accounts/:index/models` | Update `allowedModels` (`string[]` or `null` for all models) |
| `DELETE` | `/admin/api/accounts/:index` | Remove an account from memory and disk |
| `GET` | `/admin/api/models` | Fetch merged live model catalog (`?refresh=true` supported) |

---

## ⚙️ Advanced Usage

### macOS Service (Auto-start)
Install the proxy as a LaunchAgent to start automatically when you log in.

```bash
# Install
./scripts/install-macos-service.sh

# Uninstall
./scripts/uninstall-macos-service.sh
```

### Environment Variables
You can customize the proxy via `.env` file or environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP Server port |
| `OAUTH_CALLBACK_PORT` | `51121` | Local callback port for in-dashboard Google OAuth |
| `LOG_LEVEL` | `info` | Logging verbosity (`debug`, `info`, `error`) |
| `CONFIG_DIR` | `~/.config/antigravity-proxy` | Custom path for credentials storage |
| `ADMIN_ENABLED` | `true` | Enable/Disable the web dashboard |

---

## ⚠️ Disclaimer

**Educational Purpose Only.**
This software is a proxy tool intended for personal, educational, and internal development use.

- This project is **not affiliated** with Google.
- Use of this tool may violate Google's Terms of Service.
- Your accounts may be suspended or rate-limited. **Use secondary accounts.**
- No guarantees are provided regarding API stability or availability.

---

## 📜 License

**Author:** [Alessandro Bruno](https://github.com/alessandrobrunoh) & [NTRooT](https://github.com/ntroot)  
**License:** MIT

---

<div align="center">
  <sub>Made with ❤️ for the Open Source community</sub>
</div>
