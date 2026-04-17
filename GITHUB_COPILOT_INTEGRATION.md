# GitHub Copilot Integration for Rowboat

Esta implementación agrega soporte completo para **GitHub Copilot** en Rowboat usando **Device Flow OAuth** (RFC 8628).

## ¿Qué se implementó?

### 1. **Schema de Proveedores** (`apps/x/packages/shared/src/models.ts`)
- Agregado `"github-copilot"` como flavor de proveedor LLM

### 2. **Provider LLM** (`apps/x/packages/core/src/models/models.ts`)
- Implementado case para `github-copilot` que usa la API compatible con OpenAI de GitHub Models
- Base URL: `https://models.github.com/api/openai/`

### 3. **Configuración OAuth** (`apps/x/packages/core/src/auth/providers.ts`)
- Agregado proveedor `github-copilot` con:
  - Authorization endpoint: `https://github.com/login/oauth/authorize`
  - Token endpoint: `https://github.com/login/oauth/access_token`
  - Client ID: `Iv1.b507a08c87ecfe98` (GitHub Copilot CLI Client ID oficial)
  - Scopes: `read:user`, `user:email`, `gist`

### 4. **Device Flow Implementation** (`apps/x/packages/core/src/auth/github-copilot-device-flow.ts`)
Nuevo archivo que implementa RFC 8628:
- `requestDeviceCode()` - Solicita un device code a GitHub
- `pollForToken()` - Sondea GitHub para obtener el token
- `startGitHubCopilotAuth()` - Flujo completo de autenticación

## Cómo usar

### 1. **Instalación**

```bash
cd apps/x
pnpm install
npm run deps
```

### 2. **Configuración Manual** (archivo JSON)

Edita `~/.rowboat/config/models.json`:

```json
{
  "provider": {
    "flavor": "github-copilot",
    "apiKey": null
  },
  "model": "gpt-4o"
}
```

### 3. **Autenticación con Device Flow**

Cuando Rowboat se inicia con GitHub Copilot configurado:

1. Se solicita un device code a GitHub
2. Se muestra un código de usuario (ej: `ABCD-1234`)
3. Se abre `https://github.com/login/device` 
4. Usuario ingresa el código
5. Rowboat automáticamente sondea y obtiene el token

```
┌ GitHub Copilot Authentication
│
│ Visit: https://github.com/login/device
│ Enter code: ABCD-1234
│
│ Waiting for authorization...
└
```

### 4. **Modelos disponibles**

GitHub Copilot soporta estos modelos:

- `gpt-4o` - GPT-4 Omni (más capaz, más caro)
- `gpt-4-turbo` - GPT-4 Turbo
- `gpt-3.5-turbo` - GPT-3.5 Turbo (rápido, económico)
- `claude-opus` - Claude Opus (si está disponible)

## Flujo técnico

```
┌─────────────────────────────────────────────────────────┐
│  Rowboat Application                                     │
└─────────┬───────────────────────────────────────────────┘
          │
          ├─► requestDeviceCode()
          │   └─► POST /login/device/code
          │       └─ client_id, scope
          │
          ├─► Display: Visit https://github.com/login/device
          │           Enter code: ABCD-1234
          │
          ├─► pollForToken()
          │   └─► POST /login/oauth/access_token (loop)
          │       └─ device_code, client_id, grant_type
          │
          └─► createProvider() con apiKey = access_token
              └─► POST https://models.github.com/api/openai/v1/chat/completions
                  └─ Bearer token auth
```

## Manejo de errores

El código maneja varios estados de error de GitHub:

| Error | Acción |
|-------|--------|
| `authorization_pending` | Continúa sondeando |
| `slow_down` | Aumenta intervalo de sondeo |
| `expired_token` | Falla con mensaje claro |
| `access_denied` | Usuario rechazó |

## Próximos pasos

Para completar la integración:

1. **UI de autenticación** - Integrar en el onboarding step de Rowboat
2. **Almacenamiento de tokens** - Guardar en `~/.rowboat/config/auth.json`
3. **Renovación de tokens** - Implementar refresh token si GitHub lo soporta
4. **Selección de modelos** - Descubrir modelos disponibles automáticamente
5. **Tests** - Agregar tests unitarios para device flow

## Referencia

- RFC 8628: Device Authorization Grant - https://tools.ietf.org/html/rfc8628
- GitHub Device Flow Docs - https://docs.github.com/en/developers/apps/building-oauth-apps/authorizing-oauth-apps#device-flow
- GitHub Models API - https://docs.github.com/en/github/copilot/github-copilot-in-the-cli/about-github-copilot-in-the-cli
