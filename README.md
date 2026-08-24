# ATVSoft BASE

Plantilla de ATV para clonar por cliente. Cada instancia tiene su propia base de datos, su dominio y su `CompanyConfig` (nombre, logo, zona horaria, módulos).

No reutilices la base ni los secretos de otra instancia.

## Cómo montar un cliente nuevo

### 1. Clonar sin historial y crear un repo nuevo

El historial de esta plantilla no debe ir al cliente (puede contener secretos viejos del repo de origen).

```bash
git clone --depth 1 https://github.com/aleperea17/ATVSoft-BASE.git cliente-nuevo
cd cliente-nuevo
rm -rf .git
git init
git add -A
git commit -m "Plantilla inicial"
```

Creá el remoto del cliente (GitHub u otro) y empujá esa copia.

Si Fathom o Calendly estuvieron embebidos en el repo de origen, **rotá esas keys** aunque ya no estén en el código.

### 2. Crear la base

Neon (recomendado) o Postgres local. Proyecto **nuevo**, vacío.

### 3. Configurar variables de entorno

**Backend** — copiá `backend/.env.template` → `backend/.env`:

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Connection string (pooler de Neon o Postgres) |
| `JWT_SECRET` | Firma de sesión. Cambiá el placeholder |
| `REGISTER_ADMIN_KEY` | Cuentas extra después de la primera. Vacío o placeholder = registro cerrado |
| `MANYCHAT_WEBHOOK_TOKEN` | Webhook ManyChat (obligatorio para arrancar) |
| `SITE_URL` | URL pública del sitio |
| `CALL_REPORTS_VIEW_PASSWORD` | Fallback del gate de Reporte calls (manda Ajustes → Empresa) |

**Frontend** — copiá `frontend/.env.example` → `frontend/.env.local`:

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | URL pública del backend (vacío = proxy `/api-backend` en dev) |
| `BACKEND_INTERNAL_URL` | Backend que ve Next en el servidor (`http://127.0.0.1:8000` en local) |
| `NEXT_PUBLIC_SITE_URL` | Origen del sitio (webhooks) |
| `ANTHROPIC_API_KEY` | Clasificación IA (opcional) |
| `FATHOM_WEBHOOK_SECRET` / `FATHOM_API_KEY` | Reporte calls / Fathom |
| `CALENDLY_WEBHOOK_TOKEN` | Webhook Calendly |
| `CALL_REPORTS_VIEW_PASSWORD` | Mismo fallback que el backend |

No commitees `.env` ni `.env.local`.

### 4. Levantar

```bash
# Backend (desde backend/)
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000

# Frontend (desde frontend/)
npm install
npm run dev
```

El frontend en local suele quedar en `http://localhost:3000` (o 3001 si 3000 está ocupado). El backend crea las tablas al arrancar.

### 5. Primera cuenta

Entrá a `/signup` y creá el primer usuario. No pide clave de administrador. Después redirige a Equipo.

`/login` muestra **Crear la primera cuenta** mientras no haya usuarios.

### 6. Arranque operativo

1. Equipo: al menos un setter y un closer.
2. Ajustes → Programas: ofertas con precio en USD.
3. Ajustes → Empresa: marca, zona horaria, módulos, gate de calls.
4. Conexiones API: Instagram, Calendly, GHL, Fathom, ManyChat, YouTube — solo las que use el cliente.

## Configuración disponible (Ajustes → Empresa)

- Nombre y logo
- Zona horaria: Argentina o España (cambia sin reiniciar el servidor)
- Reserva en USD (cash por reserva en reportes closer; `0` = no imputar)
- Contraseña del gate de Reporte calls
- Módulos de contenido: Dashboard marketing, Reels, Historias, YouTube, BIO, Lead por reel

Un módulo apagado desaparece del menú. Si alguien entra por URL directa, ve un mensaje claro. Ventas, leads, equipo y cobranzas siguen andando.

## Decisiones de diseño

- El **embudo** se calcula desde los leads, no desde reportes diarios. Los reportes sirven para seguimiento del equipo y son la única fuente de “conversaciones”.
- Los **cobros** se registran uno por uno, con responsable obligatorio. `lead.pago` y `lead.debe` son derivados: no se editan a mano.
- Setter y closer se guardan con `member_id`. El nombre es solo para mostrar.
- El sync de Calendly y GHL **no pisa** el estado de un lead ya trabajado.
- Moneda **USD**. Zona horaria **única** y configurable.

## Qué no está incluido

Typeform (el endpoint puede existir, no forma parte del producto). Vistas sacadas de la plantilla: diferidos, referidos, objetivos, métricas.
