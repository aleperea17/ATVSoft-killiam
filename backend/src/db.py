import time

from pony.orm import *

db = Database()
_db_bound = False


def ensure_db_bound() -> bool:
    """Enlaza Pony con Postgres cuando existe `DATABASE_URL` o variables DB_* en `.env`."""
    global _db_bound
    if _db_bound:
        return True
    from src.setup_env import load_db_bind_kwargs

    kwargs = load_db_bind_kwargs()
    if not kwargs:
        return False
    db.bind(**kwargs)
    _db_bound = True
    return True


def init_db() -> None:
    if not ensure_db_bound():
        raise RuntimeError(
            "Base de datos no configurada. Configurá DATABASE_URL o "
            "DB_PROVIDER/DB_HOST (y user/pass/name) en backend/.env."
        )

    t0 = time.time()
    print("[db] Inicializando base de datos...")

    import src.models  # noqa: F401 — registrar entidades Pony antes del mapping

    db.generate_mapping(create_tables=False, check_tables=False)
    db.create_tables(check_tables=True)

    with db_session:
        for col, tipo in [
            ("conversaciones_stories", "INTEGER NOT NULL DEFAULT 0"),
            ("conversaciones_reels", "INTEGER NOT NULL DEFAULT 0"),
            ("agendas_stories", "INTEGER NOT NULL DEFAULT 0"),
            ("agendas_reels", "INTEGER NOT NULL DEFAULT 0"),
            ("agendas_ads", "INTEGER NOT NULL DEFAULT 0"),
            ("links_enviados_stories", "INTEGER NOT NULL DEFAULT 0"),
            ("links_enviados_reels", "INTEGER NOT NULL DEFAULT 0"),
        ]:
            db.execute(f"""
                ALTER TABLE setter_report
                ADD COLUMN IF NOT EXISTS {col} {tipo}
            """)

        for col, tipo in [
            ("shows_organico", "INTEGER NOT NULL DEFAULT 0"),
            ("shows_ads", "INTEGER NOT NULL DEFAULT 0"),
            ("cierres_organico", "INTEGER NOT NULL DEFAULT 0"),
            ("cierres_ads", "INTEGER NOT NULL DEFAULT 0"),
            ("reservas", "INTEGER NOT NULL DEFAULT 0"),
            ("seguimiento", "INTEGER NOT NULL DEFAULT 0"),
            ("facturacion", "DOUBLE PRECISION NOT NULL DEFAULT 0"),
        ]:
            db.execute(f"""
                ALTER TABLE closer_report
                ADD COLUMN IF NOT EXISTS {col} {tipo}
            """)

        for col, tipo in [
            ("ingresos_rango", "VARCHAR DEFAULT ''"),
            ("email", "VARCHAR DEFAULT ''"),
            ("objetivo", "VARCHAR DEFAULT ''"),
            ("situacion_actual", "TEXT DEFAULT ''"),
            ("reto_actual", "TEXT DEFAULT ''"),
        ]:
            db.execute(f"""
                ALTER TABLE lead
                ADD COLUMN IF NOT EXISTS {col} {tipo}
            """)

        # Reels: columnas de negocio usadas por PATCH /api/reels/{id}(+ /keyword)
        for col, tipo in [
            ("keyword", "VARCHAR"),
            ("dolor", "VARCHAR"),
            ("angulos", "VARCHAR"),
            ("cta", "BOOLEAN NOT NULL DEFAULT FALSE"),
            ("cash", "DOUBLE PRECISION NOT NULL DEFAULT 0"),
            ("chats_manuales", "INTEGER NOT NULL DEFAULT 0"),
        ]:
            db.execute(f"""
                ALTER TABLE reelcontent
                ADD COLUMN IF NOT EXISTS {col} {tipo}
            """)

        db.execute("""
            ALTER TABLE app_sync_settings
            ADD COLUMN IF NOT EXISTS calendly_interval_minutes INTEGER NOT NULL DEFAULT 360
        """)

        for col in [
            "nivel_dolor",
            "capacidad_decision",
            "capacidad_economica",
            "fit_real",
            "objecion_diagnostico",
            "cambio_energia",
            "objecion_no_manejada",
            "razon_real_no_cerrar",
            "compromisos_prometidos",
            "patrones_y_mejoras",
        ]:
            db.execute(f"""
                ALTER TABLE call_report
                ADD COLUMN IF NOT EXISTS {col} TEXT DEFAULT ''
            """)

        db.execute("""
            ALTER TABLE lead
            ADD COLUMN IF NOT EXISTS precio_contrato DOUBLE PRECISION
        """)
        db.execute("""
            ALTER TABLE lead
            ADD COLUMN IF NOT EXISTS contrato_pendiente BOOLEAN NOT NULL DEFAULT FALSE
        """)
        db.execute("""
            ALTER TABLE lead
            ADD COLUMN IF NOT EXISTS saldo_a_favor DOUBLE PRECISION NOT NULL DEFAULT 0
        """)
        db.execute("""
            ALTER TABLE lead
            ADD COLUMN IF NOT EXISTS proximo_vencimiento DATE
        """)
        try:
            db.execute("""
                ALTER TABLE lead ALTER COLUMN debe DROP NOT NULL
            """)
        except Exception:
            pass
        try:
            db.execute("""
                ALTER TABLE seguimiento_report
                ADD COLUMN IF NOT EXISTS lead_id INTEGER
            """)
        except Exception:
            pass
        db.execute("""
            CREATE TABLE IF NOT EXISTS lead_payment (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                lead_id INTEGER NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
                monto DOUBLE PRECISION NOT NULL,
                fecha_cobro DATE NOT NULL,
                member_id INTEGER NOT NULL,
                concepto VARCHAR DEFAULT '',
                metodo VARCHAR DEFAULT '',
                comprobante_url VARCHAR DEFAULT '',
                nota VARCHAR DEFAULT '',
                created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
            )
        """)
        db.execute("""
            CREATE INDEX IF NOT EXISTS idx_lead_payment_user_id ON lead_payment (user_id)
        """)
        db.execute("""
            CREATE INDEX IF NOT EXISTS idx_lead_payment_lead_id ON lead_payment (lead_id)
        """)

        try:
            db.execute("""
                ALTER TABLE lead
                ADD COLUMN IF NOT EXISTS setter_member_id INTEGER
            """)
            db.execute("""
                ALTER TABLE lead
                ADD COLUMN IF NOT EXISTS closer_member_id INTEGER
            """)
        except Exception:
            pass

        try:
            for table in ("companyconfig", '"CompanyConfig"'):
                db.execute(f"""
                    ALTER TABLE {table}
                    ADD COLUMN IF NOT EXISTS timezone VARCHAR NOT NULL DEFAULT 'America/Argentina/Buenos_Aires'
                """)
                db.execute(f"""
                    ALTER TABLE {table}
                    ADD COLUMN IF NOT EXISTS reserva_cash_usd DOUBLE PRECISION NOT NULL DEFAULT 0
                """)
                db.execute(f"""
                    ALTER TABLE {table}
                    ADD COLUMN IF NOT EXISTS call_reports_password VARCHAR DEFAULT ''
                """)
                for col in (
                    "module_reels",
                    "module_historias",
                    "module_youtube",
                    "module_bio",
                    "module_keywords",
                    "module_marketing_dashboard",
                ):
                    db.execute(f"""
                        ALTER TABLE {table}
                        ADD COLUMN IF NOT EXISTS {col} BOOLEAN NOT NULL DEFAULT TRUE
                    """)
        except Exception:
            pass

    from src.services.company_config_service import ensure_company_config
    from src.team_member_match import backfill_lead_member_ids

    ensure_company_config()
    backfill_lead_member_ids()

    print(f"[db] Base de datos lista ({time.time() - t0:.1f}s)")
