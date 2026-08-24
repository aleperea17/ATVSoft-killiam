# Setup wizard — replicar en copia del sistema main

Pegá este documento completo en Cursor al trabajar sobre una **copia nueva** del sistema main, para implementar el mismo flujo de primera instalación que tiene SetupATV.

Stack esperado: **Next.js (App Router) + FastAPI + Pony ORM + PostgreSQL**. Diseño **monocromático blanco y negro** (tema oscuro por defecto).

---

## Paso 0 — Limpiar la copia (OBLIGATORIO antes de implementar o probar)

La copia del sistema main **no debe traer** configuración ni datos de la instancia original. Hacé esto **primero**:

### Eliminar / no commitear

| Acción | Archivo o carpeta | Motivo |
|--------|-------------------|--------|
| **Borrar** | `backend/.env` | Sin esto `GET /api/setup/db-status` devuelve `configured: false` y el wizard empieza en `/setup`. |
| **Borrar si existen** | `backend/.env.local`, `backend/.env.production`, cualquier `backend/*.env` excepto template | Evitar credenciales heredadas del main. |
| **Borrar si existen** | `frontend/.env`, `frontend/.env.local`, `frontend/.env.development.local` | Reconfigurar proxy/backend para la instancia nueva. |
| **No copiar del main** | Secretos, tokens, `DATABASE_URL` de producción/staging | Cada deploy = DB y secrets propios. |

### Mantener como referencia (no borrar del repo)
 
- `backend/.env.template` — plantilla vacía / ejemplo Neon.
- `frontend/.env.example` — variables públicas (`NEXT_PUBLIC_*`, `BACKEND_INTERNAL_URL`, etc.).

### Opcional pero recomendado (instancia realmente limpia)

- **Base de datos:** usar un proyecto Postgres **nuevo** (ej. Neon vacío). No reutilizar la DB del sistema main: tablas, usuarios y `CompanyConfig` ya existirían y el onboarding fallaría o saltaría pasos.
- **Logos subidos:** vaciar `backend/media/logo/` si la carpeta existe y tiene archivos de otra instancia.
- **SQLite local (si aplica):** borrar `backend/*.sqlite` si el proyecto los usa en dev.
- **Sesión en el navegador:** al probar, usar ventana privada o limpiar `localStorage` / `sessionStorage` (claves tipo `auth_user_id`, `user_id`, tema `atv-theme`) para no arrastrar sesión del main.

### Crear `.env` mínimo solo cuando haga falta

- **Antes del wizard:** no hace falta `backend/.env`; el flujo `/setup` lo crea con `POST /api/setup/db-connect`.
- **Frontend en dev:** copiar `frontend/.env.example` → `frontend/.env.local` con valores locales, por ejemplo:

  ```env
  BACKEND_INTERNAL_URL=http://127.0.0.1:8000
  ```

  (sin pegar `DATABASE_URL` del main en el frontend.)

### Verificación rápida

- [ ] No existe `backend/.env` (o está vacío sin `DATABASE_URL`).
- [ ] Al levantar frontend + backend, la app redirige a `/setup`, no a `/dashboard` ni `/login` con datos viejos.
- [ ] Tras completar el wizard, recién ahí debe existir `backend/.env` generado por el backend.

**Importante:** no commitear `.env` ni subirlo al remoto. Solo templates/examples en git.

---

## Objetivo

Implementar el **flujo de primera instalación (setup wizard)** idéntico al de SetupATV:

```
/setup  →  /onboarding  →  /setup/apis  →  /login  →  /dashboard
```

---

## Redirecciones automáticas

1. **`DbBootstrapProvider`** en el layout raíz (`app/layout.tsx`):
   - Llama `GET /api/setup/db-status` (timeout 4s, no bloquea render).
   - Si `configured === false` y la ruta NO es `/setup` → `router.replace('/setup')`.
   - Si `configured === true` y la ruta ES `/setup` → `router.replace('/login')`.

2. **`/onboarding`**:
   - Al montar: `GET /api/setup/status`. Si `configured === true` → `router.replace('/login')`.
   - Tras submit exitoso → `window.location.href = '/setup/apis'` (delay 600ms).

3. **`/setup/apis`**:
   - Al cargar: si `configured === false` → `/onboarding`.
   - Botón **"Ir al sistema"** → `/login`.

4. **`/login`** (`LoginPageClient`):
   - Si `configured === false` → `router.replace('/onboarding')`.
   - Login exitoso → `/dashboard`.

5. **`/`** (home): `redirect('/dashboard')`.

---

## Pantallas — copy, layout y comportamiento

### 1. `/setup` — Base de datos

- Layout: pantalla centrada full-height, **sin** sidebar.
- Card: `max-w-lg`, `rounded-xl`, `border`, `bg-[var(--bg2)]`, `p-8`, `shadow-[var(--shadow-sm)]`.
- Título: **"Configurar base de datos"**
- Subtítulo: *"Pegá la cadena de conexión PostgreSQL (por ejemplo la que proporciona Neon) y probá la conexión."*
- Campo: `<textarea>` monoespaciado, 4 filas, placeholder `postgresql://usuario:contraseña@host...?sslmode=require`
- Botón CTA: **"Conectar"** / loading **"Conectando…"**
- `POST /api/setup/db-connect` body: `{ "connection_string": "..." }`
- Éxito: mensaje verde + redirect a `/onboarding` en 600ms.
- Error: mensaje rojo con `error` del backend.

### 2. `/onboarding` — Empresa + primer admin

- Misma card centrada que `/setup`.
- Título: **"Configurar tu empresa"**
- Subtítulo: *"Creá el primer usuario administrador y los datos públicos de tu marca."*
- Campos (labels en `text-[10px] uppercase tracking-wider`):
  - Nombre de la empresa (required)
  - Tagline (opcional)
  - Logo (opcional): file input `image/jpeg,png,webp,gif` + preview
  - Usuario (required)
  - Contraseña mínimo 6 (required)
- Botón: **"Crear sistema"** / loading **"Creando…"**
- Flujo submit:
  1. Si hay archivo → `POST /api/setup/upload-logo` (FormData)
  2. `POST /api/setup/init` con JSON:

     ```json
     {
       "company_name": "...",
       "company_tagline": "...",
       "logo_url": "/media/logo/xxx.jpg",
       "username": "...",
       "password": "..."
     }
     ```

  3. Éxito → mensaje *"Listo. Continuando con la configuración de APIs…"* → `/setup/apis`

### 3. `/setup/apis` — APIs opcionales (sin login)

- Contenedor: `max-w-7xl`, padding horizontal.
- Título: **"Configurar APIs"**
- Subtítulo: *"Podés conectar ahora o más tarde desde Conexiones API. No es obligatorio completar todo."*
- Grid de tarjetas: `ConnectionCard` con `cardLayout="setup"`.
- Plataformas en este orden (sin emojis en setup):
  `instagram`, `manychat`, `calendly`, `youtube`, `fathom`
- Cada tarjeta setup: clase `glass-card`, min-height ~260px, **sin emoji** en header.
- Tres botones en fila: **Video** | **Guía** | **Conectar** (este último con `bg-[var(--accent)]`).
- Footer derecha: botón **"Ir al sistema"** → `/login`.
- APIs:
  - `GET /api/setup/status` (guard)
  - `GET /api/connections` (listar)
  - `POST /api/connections/{platform}` body `{ "credentials": { ... } }`
- Para `manychat`, `calendly`, `fathom`: si no hay `webhook_token`, generar `crypto.randomUUID().replace(/-/g, '')` en cliente antes de guardar.

### 4. `/login` — Auth layout

- Layout `(auth)/layout.tsx`:
  - Fondo `bg-[var(--bg)]`, centrado.
  - `ThemeToggle` arriba a la derecha.
  - `AuthBranding` arriba (logo + nombre + tagline desde `GET /api/setup/config`).
  - Card login: `rounded-2xl border bg-[var(--bg2)] p-8 shadow-[var(--shadow-md)]`.
- Título: **"Iniciar sesion"**
- Form: usuario + contraseña, botón **"Iniciar sesion"** (mismas clases de inputs que onboarding).
- Login → endpoint auth existente del proyecto → redirect `/dashboard`.

---

## Backend — endpoints

Router: `prefix="/api/setup"` y conexiones `prefix="/api/connections"`.

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/setup/db-status` | `{ configured: bool }` — true si `backend/.env` tiene `DATABASE_URL` no vacío |
| POST | `/api/setup/db-connect` | Valida Postgres, escribe `.env`, `init_db()`, `{ success: true }` o `{ success: false, error }` |
| GET | `/api/setup/status` | `{ configured: bool }` — true si existe al menos un `AuthUser` |
| GET | `/api/setup/config` | `{ company_name, company_tagline, logo_url }` desde `CompanyConfig` id=1 |
| POST | `/api/setup/upload-logo` | multipart, max 6MB, jpeg/png/webp/gif → `{ url: "/media/logo/{uuid}.ext" }` |
| POST | `/api/setup/init` | Crea primer `AuthUser` (bcrypt) + `CompanyConfig` id=1. Falla si ya hay usuario. |
| GET | `/api/connections` | Lista conexiones del primer usuario (sin JWT en setup) |
| POST | `/api/connections/{platform}` | Upsert credenciales del primer usuario |

### Modelos Pony

```python
class AuthUser(db.Entity):
    id = PrimaryKey(int, auto=True)
    username = Required(str, unique=True)
    password_hash = Required(str)
    created_at = Required(datetime, default=...)
    updated_at = Optional(datetime)

class CompanyConfig(db.Entity):
    id = PrimaryKey(int)  # siempre id=1
    company_name = Required(str)
    company_tagline = Optional(str)
    logo_url = Optional(str)
    updated_at = Optional(datetime)
```

### Lifespan y archivos

- Si DB no configurada, **no** llamar `init_db()` ni scheduler hasta `db-connect`.
- Montar `/media` como StaticFiles para logos.
- `setup_env.py`: `is_db_configured()` lee `DATABASE_URL` de `backend/.env`.

---

## Frontend — archivos a crear o portar

```text
src/app/setup/page.tsx
src/app/setup/layout.tsx
src/app/setup/apis/page.tsx
src/app/setup/apis/layout.tsx
src/app/onboarding/page.tsx
src/app/onboarding/layout.tsx
src/features/setup/db-bootstrap-provider.tsx
src/features/conexiones/connection-card.tsx      # cardLayout="setup"
src/features/conexiones/connection-platforms.ts  # platformsForSetup()
src/features/auth/components/login-page-client.tsx
src/shared/lib/company-config.server.ts
src/shared/lib/backend-public-url.ts           # resolveMediaUrl()
```

En `app/layout.tsx` envolver children con:

`ThemeProvider` → `ToastProvider` → `DbBootstrapProvider`.

### Proxy API (`next.config`)

```js
{ source: '/api-backend/:path*', destination: 'http://127.0.0.1:8000/:path*' }
```

Cliente:

```ts
const API_BASE =
  (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'
```

---

## Sistema de diseño — blanco y negro (tema oscuro default)

Copiar en `globals.css` (`:root`):

```css
:root {
  --accent: #FFFFFF;
  --accent-glow: rgba(255, 255, 255, 0.2);
  --accent-faint: rgba(255, 255, 255, 0.1);

  --bg: #050505;
  --bg2: #0C0C0E;
  --bg3: #141416;
  --bg4: #1E1E22;

  --border: rgba(255, 255, 255, 0.05);
  --border2: rgba(255, 255, 255, 0.08);

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(230, 57, 70, 0.04);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(230, 57, 70, 0.06);

  --text: #FAFAFA;
  --text2: #A1A1AA;
  --text3: #52525B;

  --auth-detail: #FFFFFF;
  --auth-detail-soft: rgba(255, 255, 255, 0.92);
  --auth-cta-bg: #FFFFFF;
  --auth-cta-text: #111111;
  --auth-focus-ring: rgba(255, 255, 255, 0.25);

  --surface-accent-rgb: 255, 255, 255;
  --green: #22C55E;
  --amber: #F59E0B;
}
```

**Tema claro** (`[data-theme='light']`): invertir accent/CTA (`--accent: #111111`, `--auth-cta-bg: #111111`, `--auth-cta-text: #FFFFFF`, fondos claros).

**Tipografía:** Inter (body), JetBrains Mono (números). `body`: `antialiased`, `letter-spacing: -0.01em`.

**Inputs setup/onboarding:**

```text
w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-sm text-[var(--auth-detail)]
focus:border-[var(--auth-detail)] focus:shadow-[0_0_0_3px_var(--auth-focus-ring)]
```

**Botón CTA primario:**

```text
w-full rounded-lg bg-[var(--auth-cta-bg)] px-4 py-3 text-sm font-semibold uppercase tracking-wider text-[var(--auth-cta-text)] hover:opacity-90
```

**Tarjetas API (setup):** `.glass-card` con borde `rgba(var(--surface-accent-rgb), 0.22)`.

**Estados UI:** `idle | loading | success | error` — éxito `text-[var(--green)]`, error `text-red-500`.

**Idioma UI:** español (Argentina): "Configurá", "Pegá", "Creá", etc.

---

## Metadata dinámica

`generateMetadata()` en root layout: título = `company_name` de `/api/setup/config`, favicon = logo si existe (vía `/api-backend/media/...`).

---

## Criterios de aceptación

- [ ] Se eliminó (o no existía) `backend/.env` en la copia antes de probar el flujo.
- [ ] Instancia nueva sin `.env` abre en `/setup`.
- [ ] Tras conectar DB → `/onboarding` → crear empresa/usuario → `/setup/apis`.
- [ ] Desde APIs se puede ir a `/login` sin conectar nada.
- [ ] Si ya hay usuario, `/onboarding` y `/login` no permiten re-inicializar.
- [ ] Visual: fondo `#050505`, cards `#0C0C0E`, CTAs blancos con texto negro, acentos blancos (sin rojo como color principal).
- [ ] Logo subido se ve en login vía `AuthBranding`.
- [ ] `ConnectionCard` en modo setup: sin emoji, botones Video / Guía / Conectar.

---

## Referencia en este repo

Implementación de referencia en **SetupATV**:

- `frontend/src/app/setup/`, `frontend/src/app/onboarding/`
- `frontend/src/features/setup/db-bootstrap-provider.tsx`
- `backend/src/controllers/setup_controller.py`
- `backend/src/setup_env.py`
- `frontend/src/app/globals.css`

Implementá todo integrándolo con la estructura existente de la copia del main **sin romper** rutas ni auth actuales del dashboard.
