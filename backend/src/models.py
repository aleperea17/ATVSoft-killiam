from datetime import date, datetime
from pony.orm import Json, Optional, PrimaryKey, Required, Set, composite_key
from src.db import db


class AuthUser(db.Entity):
    id = PrimaryKey(int, auto=True)
    username = Required(str, unique=True)
    password_hash = Required(str)
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)


class CompanyConfig(db.Entity):
    """Configuración pública de marca (singleton id=1)."""

    _table_ = "companyconfig"

    id = PrimaryKey(int)
    company_name = Required(str)
    company_tagline = Optional(str, default="")
    logo_url = Optional(str, default="")
    # IANA: America/Argentina/Buenos_Aires | Europe/Madrid
    timezone = Required(str, default="America/Argentina/Buenos_Aires")
    # Cash por reserva declarada en reportes closer. 0 = no imputar.
    reserva_cash_usd = Required(float, default=0)
    # Vacío = usar CALL_REPORTS_VIEW_PASSWORD de env; ambos vacíos = gate apagado.
    call_reports_password = Optional(str, default="")
    module_reels = Required(bool, default=True)
    module_historias = Required(bool, default=True)
    module_youtube = Required(bool, default=True)
    module_bio = Required(bool, default=True)
    module_keywords = Required(bool, default=True)
    module_marketing_dashboard = Required(bool, default=True)
    updated_at = Optional(datetime)


class ApiConnection(db.Entity):
    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    platform = Required(str)
    credentials = Required(Json, default=lambda: {})
    last_sync_at = Optional(datetime)
    updated_at = Optional(datetime)

    composite_key(user_id, platform)


class StorySequence(db.Entity):
    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    sequence_date = Required(date)
    title = Optional(str, default="")
    dolor = Optional(str, default="")
    angulo = Optional(str, default="")
    cta = Required(bool, default=False)
    cash = Required(float, default=0)
    chats = Required(int, default=0)
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)
    slides = Set("StorySlide")


class StorySlide(db.Entity):
    id = PrimaryKey(int, auto=True)
    sequence = Required(StorySequence, column="sequence_id")
    order_index = Required(int)
    instagram_media_id = Optional(str)
    image_url = Optional(str)
    # views = reproducciones/impresiones (Graph `views`); reach = cuentas únicas (Graph `reach`)
    views = Optional(int)
    reach = Optional(int)
    shares = Optional(int)
    replies = Optional(int)
    navigation = Optional(int)
    profile_visits = Optional(int)
    synced_at = Optional(datetime)
    published_at = Optional(datetime)
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class ReelContent(db.Entity):
    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    instagram_id = Required(str, unique=True)
    title = Optional(str)
    thumbnail_url = Optional(str)
    permalink = Optional(str)
    fecha_publicacion = Optional(datetime)
    # Métricas Instagram
    plays = Required(int, default=0)
    reach = Required(int, default=0)
    likes = Required(int, default=0)
    comentarios = Required(int, default=0)
    shares = Required(int, default=0)
    guardados = Required(int, default=0)
    # Campos negocio
    keyword = Optional(str)
    cash = Required(float, default=0)
    chats_manuales = Required(int, default=0)
    dolor = Optional(str)
    angulos = Optional(str)
    cta = Required(bool, default=False)
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)


class YoutubeContent(db.Entity):
    """Videos de YouTube sincronizados (Data API v3) por usuario."""

    _table_ = "youtubecontent"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    external_id = Required(str)  # id del video en YouTube
    title = Optional(str)
    description = Optional(str, default="")
    thumbnail_url = Optional(str)
    published_at = Optional(datetime)
    url = Optional(str)
    duration_seconds = Optional(int)
    views = Required(int, default=0)
    likes = Required(int, default=0)
    comments_count = Required(int, default=0)
    # Analytics (YouTube Studio) no están en Data API v3 estándar; quedan para futuro / manual
    ctr = Optional(float)
    impressions = Optional(int)
    retention = Optional(float)
    avg_view_duration_seconds = Optional(int)
    performance_history = Required(Json, default=lambda: [])
    classification = Required(Json, default=lambda: {})
    cash = Required(float, default=0)
    chats = Required(int, default=0)
    notes = Optional(str, default="")
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)

    composite_key(user_id, external_id)


class MasterList(db.Entity):
    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    category = Required(str)
    items = Required(Json, default=lambda: [])
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)

    composite_key(user_id, category)


class OfferedProgram(db.Entity):
    """Programas ofrecibles en leads (nombre + precio en USD)."""

    _table_ = "offered_program"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    name = Required(str)
    price_usd = Required(float, default=0)
    sort_order = Required(int, default=0)
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class AvatarType(db.Entity):
    """Tipos de avatar/perfil de lead (nombre + color para badges en la grilla)."""

    _table_ = "avatar_type"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    nombre = Required(str)
    color = Required(str, default="#6B7280")
    activo = Required(bool, default=True)
    sort_order = Required(int, default=0)
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class Lead(db.Entity):
    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    # Identificación (Optional(str) con default="" para evitar None al instanciar en Pony)
    nombre = Optional(str, default="")
    ig = Optional(str, default="")
    email = Optional(str, default="")
    telefono = Optional(str, default="")
    avatar = Optional(str, default="")
    origen = Optional(str, default="")
    keyword = Optional(str, default="")
    content_url = Optional(str, default="")
    fecha_bot = Optional(datetime)
    respondio_auto = Optional(bool, default=False)
    manychat_contact_id = Optional(str, default="")
    # Calificación
    status = Optional(str, default="")
    via = Optional(str, default="")
    punto_agenda = Optional(str, default="")
    ctas_respondidos = Optional(int, default=0)
    primer_contacto = Optional(datetime)
    # Agenda (agendo = cuándo completó el formulario / webhook Calendly; call = slot elegido; agendo_en = canal)
    agendo = Optional(datetime)
    agendo_en = Optional(str)
    dias_para_agendar = Optional(int)
    call = Optional(datetime)
    link_llamada = Optional(str, default="")
    # Negocio (setter/closer = nombre para display; *_member_id para agrupar)
    setter = Optional(str, default="")
    closer = Optional(str, default="")
    setter_member_id = Optional(int)
    closer_member_id = Optional(int)
    dolores_setting = Optional(str, default="")
    ingresos_lead = Optional(float, default=0)
    ingresos_rango = Optional(str, default="")
    dolores_llamada = Optional(str, default="")
    closer_report = Optional(str, default="")
    razon_compra = Optional(str, default="")
    objetivo = Optional(str, default="")
    situacion_actual = Optional(str, default="")
    reto_actual = Optional(str, default="")
    programa_ofrecido = Optional(str, default="")
    programada_ofrecido_llamada = Optional(str, default="")
    # Ventas. `pago` y `debe` son derivados de `lead_payment` + precio efectivo.
    # Montos en USD. `debe` es NULL si contrato_pendiente (no confundir con 0).
    pago = Optional(float, default=0)
    debe = Optional(float)
    precio_contrato = Optional(float)
    contrato_pendiente = Required(bool, default=False)
    # max(0, pago − precio_contrato). No se deja debe negativo.
    saldo_a_favor = Optional(float, default=0)
    proximo_vencimiento = Optional(date)
    estado = Optional(str, default="")
    notas = Optional(str, default="")
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class TeamMember(db.Entity):
    _table_ = "teammember"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    nombre = Required(str)
    rol = Required(str)  # 'setter' | 'closer' | 'cash'
    activo = Required(bool, default=True)
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class SetterReport(db.Entity):
    _table_ = "setter_report"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    member_id = Required(int)
    fecha = Required(date)
    conversaciones = Required(int, default=0)
    agendas = Required(int, default=0)
    links_enviados = Required(int, default=0)
    conversaciones_stories = Required(int, default=0)
    conversaciones_reels = Required(int, default=0)
    agendas_stories = Required(int, default=0)
    agendas_reels = Required(int, default=0)
    agendas_ads = Required(int, default=0)
    links_enviados_stories = Required(int, default=0)
    links_enviados_reels = Required(int, default=0)
    notas = Optional(str, default="")
    sentimiento_trafico = Optional(str, default="")
    avatar_tipo_agendas = Optional(str, default="")
    insights_marketing = Optional(str, default="")
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class CloserReport(db.Entity):
    _table_ = "closer_report"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    member_id = Required(int)
    fecha = Required(date)
    reporte_tipo = Required(str, default="ventas")  # 'ventas' | 'marketing'
    llamadas_agendadas = Required(int, default=0)
    shows = Required(int, default=0)
    cierres = Required(int, default=0)
    shows_organico = Required(int, default=0)
    shows_ads = Required(int, default=0)
    cierres_organico = Required(int, default=0)
    cierres_ads = Required(int, default=0)
    reservas = Required(int, default=0)
    seguimiento = Required(int, default=0)
    facturacion = Required(float, default=0)
    calificados = Required(int, default=0)
    descalificados = Required(int, default=0)
    ingreso = Required(float, default=0)
    notas = Optional(str, default="")
    nombre_lead = Optional(str, default="")
    estado_final_llamada = Optional(str, default="")
    perfil_lead = Optional(str, default="")
    objecion_miedo = Optional(str, default="")
    dolores_llamada = Optional(str, default="")
    razon_compra_final = Optional(str, default="")
    insights_marketing_llamada = Optional(str, default="")
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class AppSyncSettings(db.Entity):
    """Config global del servidor: intervalos de sync automático (singleton id=1)."""

    _table_ = "app_sync_settings"

    id = PrimaryKey(int)
    stories_interval_minutes = Required(int, default=5)
    reels_interval_minutes = Required(int, default=1440)
    calendly_interval_minutes = Required(int, default=360)  # 6 h
    updated_at = Optional(datetime)


class SeguimientoReport(db.Entity):
    """Cobranzas / seguimiento declaradas por setter, closer o cash; el dinero vive en lead_payment."""

    _table_ = "seguimiento_report"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    member_id = Required(int)
    lead_id = Optional(int)
    fecha = Required(date)
    nombre_lead = Required(str)
    monto = Required(float, default=0)
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class LeadPayment(db.Entity):
    """Cobro individual de un lead. Única vía de escritura de dinero (v1 cobranzas)."""

    _table_ = "lead_payment"

    id = PrimaryKey(int, auto=True)
    user_id = Required(int, index=True)
    lead_id = Required(int, index=True)
    monto = Required(float)
    fecha_cobro = Required(date)
    member_id = Required(int)
    concepto = Optional(str, default="")
    metodo = Optional(str, default="")
    comprobante_url = Optional(str, default="")
    nota = Optional(str, default="")
    created_at = Required(datetime, default=lambda: datetime.utcnow())


class CallReport(db.Entity):
    """Análisis de llamada Fathom (1 link = 1 reporte)."""

    _table_ = "call_report"

    id = PrimaryKey(int, auto=True)
    lead_id = Required(int, index=True)
    lead_nombre = Optional(str, default="")
    fathom_url = Required(str, unique=True)
    estado = Required(str, default="pendiente")
    error_msg = Optional(str, default="")
    participantes = Optional(str, default="")
    motivo_reunion = Optional(str, default="")
    # Formato nuevo (calificación + coaching).
    nivel_dolor = Optional(str, default="")
    capacidad_decision = Optional(str, default="")
    capacidad_economica = Optional(str, default="")
    fit_real = Optional(str, default="")
    objecion_diagnostico = Optional(str, default="")
    cambio_energia = Optional(str, default="")
    objecion_no_manejada = Optional(str, default="")
    razon_real_no_cerrar = Optional(str, default="")
    compromisos_prometidos = Optional(str, default="")
    patrones_y_mejoras = Optional(str, default="")
    # Campos legacy (reportes anteriores); se muestran solo si el formato nuevo está vacío.
    resumen = Optional(str, default="")
    hubo_objeciones = Optional(str, default="")
    tipo_perfil = Optional(str, default="")
    ingresos_estimados = Optional(str, default="")
    situacion_y_deseo = Optional(str, default="")
    closer_report = Optional(str, default="")
    dolores_llamada = Optional(str, default="")
    razon_compra = Optional(str, default="")
    program_offered = Optional(str, default="")
    status_llamada = Optional(str, default="")
    user_id = Required(int, index=True)
    created_at = Required(datetime, default=lambda: datetime.utcnow())
    updated_at = Optional(datetime)
