# GitHub Copilot Integration - End-to-End Testing Guide

Este documento describe cómo realizar pruebas end-to-end completas de la integración de GitHub Copilot en Rowboat.

## Requisitos Previos

- Rowboat compilado y funcionando (`npm run deps` sin errores)
- Cuenta de GitHub activa
- Acceso a GitHub Copilot (Student, Pro, o Enterprise)

## Test 1: Verificar Compilación

```bash
cd /home/wilber/rowboat/apps/x

# Compilar todas las dependencias
npm run deps

# Verificar que no hay errores de TypeScript
npm run lint

# Expected output:
# ✓ shared compiled successfully
# ✓ core compiled successfully
# ✓ preload compiled successfully
```

## Test 2: Verificar Tests Unitarios

```bash
# Ejecutar tests de GitHub Copilot
npm test -- github-copilot.test.ts

# Expected output:
# ✓ GitHub Copilot Device Flow
#   ✓ requestDeviceCode
#   ✓ pollForToken
#   ✓ startGitHubCopilotAuth
#   ✓ OAuthTokens validation
# ✓ GitHub Copilot Models
#   ✓ Model availability
#   ✓ Model constants
# 
# Tests: 25+ passed
```

## Test 3: Device Flow Authentication (Manual)

### Paso 1: Crear un script de prueba

Crea `/tmp/test-github-copilot-auth.ts`:

```typescript
import container from '@x/core/di/container';
import { startGitHubCopilotAuthentication, isGitHubCopilotAuthenticated, getGitHubCopilotAuthStatus } from '@x/core/auth/github-copilot-auth';

async function testAuth() {
  console.log('Starting GitHub Copilot authentication test...\n');

  // Paso 1: Iniciar autenticación
  console.log('1️⃣ Iniciando Device Flow...');
  const { userCode, verificationUri, tokenPromise } = await startGitHubCopilotAuthentication();
  
  console.log(`\n📱 Código de dispositivo: ${userCode}`);
  console.log(`🔗 Visita: ${verificationUri}`);
  console.log('\n⏳ Esperando autorización... (timeout en 15 minutos)\n');

  try {
    // Paso 2: Esperar autenticación
    await tokenPromise;
    console.log('✅ ¡Autenticado exitosamente!\n');

    // Paso 3: Verificar estado
    const authenticated = await isGitHubCopilotAuthenticated();
    console.log(`2️⃣ ¿Autenticado? ${authenticated ? '✅ Sí' : '❌ No'}`);

    const status = await getGitHubCopilotAuthStatus();
    console.log(`3️⃣ Estado:`, JSON.stringify(status, null, 2));

    console.log('\n✨ Test completo exitosamente');
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

testAuth();
```

### Paso 2: Ejecutar el test

```bash
cd /home/wilber/rowboat/apps/x
npx ts-node /tmp/test-github-copilot-auth.ts

# Expected output:
# 1️⃣ Iniciando Device Flow...
# 
# 📱 Código de dispositivo: ABCD-1234
# 🔗 Visita: https://github.com/login/device
# 
# ⏳ Esperando autorización... (timeout en 15 minutos)
# 
# (Usuario visita GitHub, ingresa código ABCD-1234)
# 
# ✅ ¡Autenticado exitosamente!
# 
# 2️⃣ ¿Autenticado? ✅ Sí
# 3️⃣ Estado: {
#   "authenticated": true,
#   "expiresAt": 1234567890
# }
# 
# ✨ Test completo exitosamente
```

## Test 4: Crear proveedor LLM

```typescript
import { createProvider } from '@x/core/models/models';
import { generateText } from 'ai';

async function testLLM() {
  console.log('Testing GitHub Copilot LLM...\n');

  // Crear proveedor
  console.log('1️⃣ Creando proveedor GitHub Copilot...');
  const config = {
    flavor: 'github-copilot' as const,
  };
  const provider = await createProvider(config);
  console.log('✅ Proveedor creado\n');

  // Crear modelo
  console.log('2️⃣ Creando modelo gpt-4o...');
  const model = provider.languageModel('gpt-4o');
  console.log('✅ Modelo creado\n');

  // Generar texto
  console.log('3️⃣ Enviando prompt a GitHub Copilot...');
  const response = await generateText({
    model,
    prompt: 'Say hello in Spanish',
  });
  console.log('✅ Respuesta recibida:\n');
  console.log(response.text);
}

testLLM();
```

## Test 5: Verificar Almacenamiento de Tokens

```bash
# Ver tokens guardados
cat ~/.rowboat/config/oauth.json | jq '.providers."github-copilot"'

# Expected output:
# {
#   "tokens": {
#     "access_token": "ghu_...",
#     "refresh_token": null,
#     "expires_at": 1234567890,
#     "token_type": "Bearer",
#     "scopes": ["read:user", "user:email", "gist"]
#   },
#   "clientId": "Iv1.b507a08c87ecfe98"
# }
```

## Test 6: Probar Refresh de Tokens

```typescript
import { getGitHubCopilotAccessToken } from '@x/core/auth/github-copilot-auth';
import * as oauthClient from '@x/core/auth/oauth-client';

async function testTokenRefresh() {
  console.log('Testing token refresh...\n');

  // Obtener token actual
  console.log('1️⃣ Obteniendo token de acceso...');
  const token = await getGitHubCopilotAccessToken();
  console.log(`✅ Token: ${token.substring(0, 20)}...\n`);

  // Verificar expiración
  console.log('2️⃣ Verificando expiración...');
  const connection = await container.resolve('oauthRepo').read('github-copilot');
  if (connection.tokens) {
    const expiresIn = connection.tokens.expires_at - Math.floor(Date.now() / 1000);
    console.log(`✅ Token expira en: ${expiresIn} segundos`);
    if (expiresIn > 3600) {
      console.log('   (Aún es válido por más de 1 hora)\n');
    }
  }
}

testTokenRefresh();
```

## Test 7: Listar Modelos Disponibles

```typescript
import { getAvailableGitHubCopilotModels } from '@x/core/auth/github-copilot-models';

async function testModels() {
  console.log('Modelos disponibles en GitHub Copilot:\n');
  
  const models = await getAvailableGitHubCopilotModels();
  models.forEach((model, i) => {
    console.log(`${i + 1}. ${model}`);
  });
}

testModels();
```

## Test 8: Desconectar GitHub Copilot

```typescript
import { disconnectGitHubCopilot, isGitHubCopilotAuthenticated } from '@x/core/auth/github-copilot-auth';

async function testDisconnect() {
  console.log('Desconectando GitHub Copilot...\n');

  console.log('1️⃣ Estado antes: ', await isGitHubCopilotAuthenticated());
  
  await disconnectGitHubCopilot();
  
  console.log('2️⃣ Estado después: ', await isGitHubCopilotAuthenticated());
  
  console.log('\n✅ Desconectado correctamente');
}

testDisconnect();
```

## Verificación de Checklist

- [ ] Compilación exitosa sin errores TypeScript
- [ ] Tests unitarios pasan (25+ casos)
- [ ] Device Flow funciona y abre el navegador
- [ ] Usuario puede completar autenticación en GitHub
- [ ] Tokens se guardan en `~/.rowboat/config/oauth.json`
- [ ] Proveedor LLM se crea correctamente
- [ ] Modelo responde a prompts
- [ ] Token se actualiza automáticamente si expira
- [ ] Tokens se eliminan al desconectar
- [ ] Modelos disponibles se listan correctamente

## Troubleshooting

### Error: "GitHub Copilot not authenticated"
- Ejecutar Device Flow nuevamente: `startGitHubCopilotAuthentication()`
- Verificar que tokens existen: `cat ~/.rowboat/config/oauth.json`

### Error: "Token expired"
- El sistema debería intentar refresh automático
- Si falla, ejecutar Device Flow nuevamente

### Error: "Cannot reach API"
- Verificar conexión a internet
- Verificar que `https://models.github.com/api/openai/` es accesible
- Verificar que token es válido: `npm run test -- github-copilot`

### Error: "Model not found"
- Verificar que el modelo está disponible en tu plan
- Usar `gpt-4o` como fallback

## Recursos Adicionales

- [GITHUB_COPILOT_INTEGRATION.md](./GITHUB_COPILOT_INTEGRATION.md) - Documentación técnica completa
- [RFC 8628](https://tools.ietf.org/html/rfc8628) - Device Flow OAuth spec
- [GitHub Copilot Docs](https://docs.github.com/en/copilot) - Documentación oficial

## Notas de Seguridad

- **Nunca** compartas tu código de dispositivo
- Los tokens se almacenan en `~/.rowboat/config/oauth.json` - asegúrate de que los permisos son correctos
- Desconecta cuando no uses GitHub Copilot
- Los tokens expiran automáticamente (generalmente en 8 horas)
