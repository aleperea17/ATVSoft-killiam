from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str


class AuthRegisterRequest(BaseModel):
    username: str
    password: str
    admin_key: str | None = None


class AuthSetupStatusResponse(BaseModel):
    needs_setup: bool
    extra_signup_allowed: bool


class AuthLoginRequest(BaseModel):
    username: str
    password: str


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int


class AuthMeResponse(BaseModel):
    username: str
    user_id: int


class AuthChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class MasterListUpsertRequest(BaseModel):
    items: list[str] = Field(default_factory=list)


class MasterListAddItemRequest(BaseModel):
    item: str = ""


class MasterListsResponse(BaseModel):
    dolores: list[str] = Field(default_factory=list)
    angulos: list[str] = Field(default_factory=list)


class OfferedProgramOut(BaseModel):
    id: int
    name: str
    price_usd: float
    sort_order: int


class OfferedProgramsListResponse(BaseModel):
    programs: list[OfferedProgramOut] = Field(default_factory=list)


class OfferedProgramCreateRequest(BaseModel):
    name: str = ""
    price_usd: float = 0


class OfferedProgramPatchRequest(BaseModel):
    name: str | None = None
    price_usd: float | None = None
    sort_order: int | None = None


class AvatarTypeOut(BaseModel):
    id: int
    nombre: str
    color: str
    activo: bool
    sort_order: int


class AvatarTypesListResponse(BaseModel):
    avatars: list[AvatarTypeOut] = Field(default_factory=list)


class AvatarTypeCreateRequest(BaseModel):
    nombre: str = ""
    color: str = "#6B7280"
    activo: bool = True


class AvatarTypePatchRequest(BaseModel):
    nombre: str | None = None
    color: str | None = None
    activo: bool | None = None
    sort_order: int | None = None


class ApiConnectionResponse(BaseModel):
    id: str
    user_id: str
    platform: str
    credentials: dict[str, Any] = Field(default_factory=dict)
    last_sync_at: datetime | None = None
    updated_at: datetime | None = None


class ApiConnectionUpsertRequest(BaseModel):
    credentials: dict[str, Any] = Field(default_factory=dict)


class ReelResponse(BaseModel):
    id: str
    title: str | None = None
    content_type: str
    platform: str
    metrics: dict[str, Any] = Field(default_factory=dict)
    classification: dict[str, Any] = Field(default_factory=dict)
    cash: float = 0
    chats: int = 0
    published_at: datetime | None = None
    url: str | None = None
    notes: str | None = None
    external_id: str
    keyword: str | None = None
    content_url: str | None = None
    chats_count: int = 0
    manual_cash: float | None = None
    manual_chats: int | None = None
    cash_total: float = 0
    cpc: float = Field(0, description="Cash por chat (cash ÷ chats).")
    agendas: int = 0


class ReelsListResponse(BaseModel):
    reels: list[ReelResponse] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 10
    total_pages: int = 0
    available_months: list[str] = Field(default_factory=list)
    total_cash: float = 0
    total_chats: int = 0


class ReelPatchRequest(BaseModel):
    cash: float | None = None
    chats: int | None = None
    chats_manuales: int | None = None
    dolor: str | None = None
    angulos: str | None = None
    cta: bool | None = None



class ReelKeywordPatchRequest(BaseModel):
    keyword: str | None = None


class ReelsSyncRequest(BaseModel):
    limit: int | None = None


class ReelsSyncRangeDiscoverRequest(BaseModel):
    """Sin parámetros: cuenta todos los reels de la cuenta de Instagram conectada (vista previa rápida)."""


class ReelsSyncRangeImportRequest(BaseModel):
    take: int = Field(ge=1, description="Cantidad de reels a importar (≤ total hallado en discover).")


class ReelsSyncResponse(BaseModel):
    success: bool
    total: int = 0
    new: int = 0
    updated: int = 0
    detail: str | None = None


class ReelsMetricsOut(BaseModel):
    chats_del_mes: int
    piezas_publicadas: int
    reels_con_cta: int
    reels_sin_cta: int


class ManychatChatResponse(BaseModel):
    id: str
    keyword: str
    contact_name: str | None = None
    contact_ig_username: str | None = None
    received_at: datetime
    """ID suscriptor ManyChat (si viene de la API live)."""
    manychat_subscriber_id: str | None = None
    """Último texto que envió el contacto (API ManyChat), suele ser la keyword."""
    manychat_last_input: str | None = None
    """Resumen de custom fields del suscriptor (para contexto / bio)."""
    manychat_custom_fields_preview: str | None = None
    lead_airtable_record_id: str | None = None  # ID externo legacy (opcional)
    lead_status: str | None = None
    lead_client_name: str | None = None
    lead_program_offered: str | None = None
    lead_payment: float | None = None
    lead_revenue: float | None = None
    lead_ig_bio_snapshot: str | None = None
    lead_automation_reply_snapshot: str | None = None


class BioManualEntryResponse(BaseModel):
    id: str
    name: str | None = None
    date: datetime | None = None
    chats: int = 0
    cash: float = 0
    notes: str | None = None


class BioDataResponse(BaseModel):
    auto_chats: list[ManychatChatResponse] = Field(default_factory=list)
    manual_entries: list[BioManualEntryResponse] = Field(default_factory=list)
    is_connected: bool = False
    available_months: list[str] = Field(default_factory=list)
    manychat_automation_name: str | None = None
    manychat_bio_tag_id: int | None = None
    manychat_bio_tag_reply_id: int | None = None


class ManychatLiveSummaryResponse(BaseModel):
    page_name: str | None = None
    category: str | None = None
    timezone: str | None = None
    tags_count: int = 0
    growth_tools_count: int = 0
    custom_fields_count: int = 0
    bot_fields_count: int = 0
    sample_tags: list[str] = Field(default_factory=list)
    sample_growth_tools: list[str] = Field(default_factory=list)


class ManychatAutomationStatsResponse(BaseModel):
    """
    Métricas aproximadas para la automatización BIO.
    ManyChat no documenta un endpoint público equivalente al panel (envíos, % abierto por nodo);
    usamos getFlows + conteo de contactos por tags configurados.
    """

    info_note: str | None = None
    flow_found: bool = False
    flow_name: str | None = None
    flow_ns: str | None = None
    """Objeto del flow devuelto por getFlows (puede incluir campos extra según versión de API)."""
    flow_raw: dict[str, Any] = Field(default_factory=dict)
    getflows_error: str | None = None

    entry_tag_id: int | None = None
    entry_tag_name: str | None = None
    entry_contacts_count: int = 0
    entry_tag_error: str | None = None

    reply_tag_id: int | None = None
    reply_tag_name: str | None = None
    reply_contacts_count: int = 0
    reply_tag_error: str | None = None

    reply_rate_percent: float | None = None


class BioManualEntryCreateRequest(BaseModel):
    month: str | None = None
    name: str | None = None
    date: datetime | None = None
    chats: int = 0
    cash: float = 0
    notes: str | None = None


class BioAutomationConfigRequest(BaseModel):
    manychat_automation_name: str | None = None
    manychat_bio_tag_id: int | None = None
    """Tag ManyChat de quienes completan el embudo (ej. 'responde la auto de la bio')."""
    manychat_bio_tag_reply_id: int | None = None


class BioLeadResponse(BaseModel):
    id: str
    handle: str
    nombre: str | None = None
    avatar_url: str | None = None
    subscribed_at: str | None = None
    keyword: str | None = None
    """Origen / canal (ej. Perfil, Automático - ManyChat)."""
    via: str | None = None
    airtable_found: bool = False
    airtable_record_id: str | None = None
    status: str | None = None
    setter: str | None = None
    programa: str | None = None
    pago: float | None = None
    fecha_agendo: str | None = None
    llamada_url: str | None = None
    dolores: str | None = None
    razon_compra: str | None = None
    notas: str | None = None
    manychat_chat_url: str | None = None
    respondio_auto: bool = False
    # Campos tabla Lead (Neon)
    content_url: str | None = None
    manychat_contact_id: str | None = None
    programa_ofrecido: str | None = None
    fecha_bot: str | None = None
    agendo: bool = False


class BioLeadsListResponse(BaseModel):
    leads: list[BioLeadResponse] = Field(default_factory=list)
    manychat_active: bool = True
    connected_to_airtable: bool = False
    bio_profile_keyword: str = Field(default="info", description="Keyword de bio configurada en ManyChat")


class BioLeadStatusPatchRequest(BaseModel):
    status: str


class BioLeadDescriptionPatchRequest(BaseModel):
    bio_descripcion: str | None = None


class BioMetricsResponse(BaseModel):
    total_leads: int = 0
    agendaron: int = 0
    cerrados: int = 0
    tasa_agenda: float = 0
    cash_total: float = 0
    cash_por_chat: float = 0
    respondio_auto: int = 0
    tasa_respuesta_auto: float | None = None
    cash_por_lead: float = 0
    tasa_conversion: float = Field(default=0, description="Alias de tasa_agenda (compatibilidad vista BIO)")


class BioManychatStatusResponse(BaseModel):
    connected: bool = False
    tag: str = ""
    total_subscribers: int = 0


class BioViaOptionsResponse(BaseModel):
    """Valores únicos del campo Vía en leads."""

    options: list[str] = Field(default_factory=list)


class StorySlideIn(BaseModel):
    order_index: int
    image_url: str | None = None
    dolor: str | None = None
    angulo: str | None = None
    cta_text: str | None = None


class StorySequenceIn(BaseModel):
    sequence_date: date
    title: str | None = None
    dolor: str | None = None
    angulo: str | None = None
    cta: bool = False
    cash_manual: int | None = None
    chats: int | None = None
    slides: list[StorySlideIn] = Field(default_factory=list)


class StorySequencePatchRequest(BaseModel):
    dolor: str | None = None
    angulos: str | None = None
    cta: bool | None = None
    cash_manual: int | None = None
    chats: int | None = None


class StorySlideOut(BaseModel):
    id: int
    order_index: int
    image_url: str | None = None
    dolor: str | None = None
    angulo: str | None = None
    cta_text: str | None = None
    instagram_media_id: str | None = None
    views: int | None = None
    reach: int | None = None
    shares: int | None = None
    like_count: int | None = None
    replies: int | None = None
    navigation: int | None = None
    profile_visits: int | None = None
    synced_at: str | None = None
    published_at: str | None = None


class StorySequenceOut(BaseModel):
    id: int
    sequence_date: str
    title: str | None = None
    dolor: str | None = None
    angulo: str | None = None
    cta: bool = False
    cash_generado: int = 0
    cash_manual: int = 0
    cash_leads: int = 0
    agendas: int = 0
    chats: int
    slides: list[StorySlideOut] = Field(default_factory=list)
    created_at: str


class StoriesMetricsOut(BaseModel):
    chats_del_mes: int
    secuencias_con_cta: int
    secuencias_sin_cta: int
    stories_sincronizadas: int


class YoutubeVideoPatchRequest(BaseModel):
    cash_manual: int | None = None


class LeadOut(BaseModel):
    """Paridad con `Lead` en BD + campos que usa la tabla del frontend."""

    id: str
    lead_user_id: str = Field(..., description="user_id del dueño del lead (columna user_id en BD)")
    client_name: str = ""
    ig_handle: str | None = None
    phone: str | None = None
    avatar_type: str | None = None
    status: str = "Pendiente"
    origin: str | None = None
    entry_channel: str | None = None
    entry_funnel: str | None = None
    keyword: str | None = Field(default=None, description="keyword en BD (ManyChat / reel)")
    agenda_point: str | None = None
    ctas_responded: int = 0
    first_contact_at: str | None = None
    fecha_bot: str | None = None
    scheduled_at: str | None = Field(
        default=None,
        description="Fecha/hora de la llamada (columna call en BD; Calendly).",
    )
    agendo: str | None = Field(
        default=None,
        description="ISO: momento en que completó el formulario Calendly (webhook invitee.created).",
    )
    agendo_en: str | None = Field(
        default=None,
        description='Canal donde agendó: "Chat", "Youtube" (columna agendo_en en BD, texto).',
    )
    call_at: str | None = None
    call: str | None = Field(default=None, description="ISO fecha/hora de la cita (misma columna `call` en BD)")
    call_link: str | None = None
    closer_report: str | None = None
    program_offered: str | None = Field(
        default=None,
        description="Programa comprado / facturación (columna `programa_ofrecido` en BD).",
    )
    programada_ofrecido_llamada: str | None = Field(
        default=None,
        description="Programa ofrecido en la llamada (solo CRM; no entra en facturación). Columna `programada_ofrecido_llamada`.",
    )
    program_price_usd: float | None = Field(
        default=None,
        description="Precio en USD del catálogo (OfferedProgram) si coincide `programa_ofrecido` en BD.",
    )
    revenue: float = 0
    payment: float = 0
    owed: float | None = None
    precio_contrato: float | None = None
    contrato_pendiente: bool = False
    closer: str | None = None
    setter: str | None = None
    setter_member_id: int | None = None
    closer_member_id: int | None = None
    notes: str | None = None
    date: str
    month: str | None = None
    email: str | None = None
    dolores_setting: str | None = None
    dolores_llamada: str | None = None
    razon_compra: str | None = None
    objetivo: str | None = None
    situacion_actual: str | None = None
    reto_actual: str | None = None
    dias_agendamiento: int | None = Field(
        default=None,
        description="Días desde 1er contacto hasta completar formulario Calendly (primer_contacto → agendo).",
    )
    ingresos_mensuales: float = 0
    ingresos_rango: str | None = None
    compromiso: str | None = None
    urgencia: str | None = None
    disposicion_invertir: str | None = None
    calendly_event_uri: str | None = None
    calendly_invitee_uri: str | None = None
    source_type: str | None = None
    content_url: str | None = None
    manychat_contact_id: str | None = None
    respondio_auto: bool | None = None


class LeadsListResponse(BaseModel):
    leads: list[LeadOut] = Field(default_factory=list)


class LeadsMetricsOut(BaseModel):
    """Agregados del mes para el dashboard (todos los leads del usuario, no solo BIO)."""

    total_leads: int = 0
    agendaron: int = 0
    cash_total: float = 0
    cash_por_chat: float = 0


class LeadPatchRequest(BaseModel):
    """Campos opcionales alineados con `LeadOut` / tabla de leads (solo los que existen en BD)."""

    client_name: str | None = None
    ig_handle: str | None = None
    phone: str | None = None
    avatar_type: str | None = None
    status: str | None = None
    origin: str | None = None
    origen: str | None = Field(default=None, description="Alias de origin en PATCH (JSON en español)")
    entry_channel: str | None = None
    via: str | None = Field(default=None, description="Alias de entry_channel → columna via en BD")
    entry_funnel: str | None = None
    keyword: str | None = None
    agenda_point: str | None = None
    punto_agenda: str | None = Field(
        default=None,
        description="Alias de agenda_point → columna punto_agenda en BD",
    )
    ctas_responded: int | None = None
    first_contact_at: str | None = None
    scheduled_at: str | None = None
    agendo_en: str | None = Field(
        default=None,
        description='Chat | Youtube → columna agendo_en (texto) en BD.',
    )
    agendo: str | None = Field(
        default=None,
        description="ISO → cuándo completó el formulario (columna agendo en BD).",
    )
    call: str | None = Field(default=None, description="ISO fecha/hora → columna call (alias de scheduled_at)")
    call_link: str | None = None
    program_offered: str | None = None
    programada_ofrecido_llamada: str | None = None
    revenue: float | None = None
    ingresos_mensuales: float | None = None
    payment: float | None = None
    owed: float | None = None
    notes: str | None = None
    dolores_setting: str | None = None
    dolores_llamada: str | None = None
    closer_report: str | None = None
    razon_compra: str | None = None
    objetivo: str | None = None
    situacion_actual: str | None = None
    reto_actual: str | None = None
    ingresos_rango: str | None = None
    setter: str | None = None
    closer: str | None = None
    setter_member_id: int | None = None
    closer_member_id: int | None = None


class LeadCreateRequest(BaseModel):
    """Alta manual de lead (cuenta como agendado para listados y métricas del mes)."""

    client_name: str = Field(min_length=1, max_length=500)
    ig_handle: str | None = None
    phone: str | None = None
    notes: str | None = None
    month: str | None = Field(
        default=None,
        description="YYYY-MM mes operativo (fecha_bot / agendo); si se omite, mes actual en Argentina.",
    )
    entry_channel: str | None = Field(
        default=None,
        description="Normalizado como `via` (por defecto texto Manual).",
    )
    status: str | None = Field(default="Pendiente")


class KeywordClientRow(BaseModel):
    """Lead con keyword y reel asociado (misma keyword que un reel del usuario, si existe)."""

    lead_id: str
    nombre: str = ""
    instagram: str = ""
    reel_id: str | None = Field(default=None, description="ID interno del reel (BD), si existe match por keyword.")
    reel_permalink: str | None = None
    reel_published_at: str | None = Field(
        default=None,
        description="Fecha de publicación del reel (YYYY-MM-DD), si existe.",
    )
    keyword: str


class KeywordsReelOption(BaseModel):
    id: str
    label: str


class KeywordsMetrics(BaseModel):
    total_rows: int = 0
    unique_leads: int = 0
    unique_keywords: int = 0
    rows_with_reel: int = 0
    unique_reels: int = 0


class KeywordsSeriesDay(BaseModel):
    day: str = Field(description="YYYY-MM-DD")
    rows: int = 0
    leads: int = 0


class KeywordsTopKeyword(BaseModel):
    keyword: str
    rows: int = 0
    leads: int = 0


class KeywordsTopReel(BaseModel):
    reel_id: str
    label: str
    rows: int = 0


class KeywordsMetricsResponse(BaseModel):
    metrics: KeywordsMetrics = Field(default_factory=KeywordsMetrics)
    series_days: list[KeywordsSeriesDay] = Field(default_factory=list)
    top_keywords: list[KeywordsTopKeyword] = Field(default_factory=list)
    top_reels: list[KeywordsTopReel] = Field(default_factory=list)
    reels: list[KeywordsReelOption] = Field(default_factory=list)


class KeywordsListResponse(BaseModel):
    rows: list[KeywordClientRow] = Field(default_factory=list)
    total: int = 0
    reels: list[KeywordsReelOption] = Field(
        default_factory=list,
        description="Opciones de reels con keyword para filtro en frontend.",
    )
    metrics: KeywordsMetrics = Field(default_factory=KeywordsMetrics)


class SyncSettingsOut(BaseModel):
    stories_interval_minutes: int
    reels_interval_minutes: int
    calendly_interval_minutes: int = 360
    stories_next_sync: str | None = None
    reels_next_sync: str | None = None
    calendly_next_sync: str | None = None
    min_interval_minutes: int = 1
    max_interval_minutes: int = 10080
    min_calendly_interval_minutes: int = 60
    max_calendly_interval_minutes: int = 10080


class SyncSettingsPatch(BaseModel):
    stories_interval_minutes: int | None = Field(
        default=None,
        description="Minutos entre sync automático de historias (Instagram).",
    )
    reels_interval_minutes: int | None = Field(
        default=None,
        description="Minutos entre refresh automático de métricas de reels.",
    )
    calendly_interval_minutes: int | None = Field(
        default=None,
        description="Minutos entre auto-check/sync de Calendly (p. ej. 360=6h, 720=12h).",
    )


class CallReportOut(BaseModel):
    id: str
    lead_id: str
    lead_nombre: str = ""
    fathom_url: str
    estado: str
    error_msg: str | None = None
    participantes: str | None = None
    motivo_reunion: str | None = None
    nivel_dolor: str | None = None
    capacidad_decision: str | None = None
    capacidad_economica: str | None = None
    fit_real: str | None = None
    objecion_diagnostico: str | None = None
    cambio_energia: str | None = None
    objecion_no_manejada: str | None = None
    razon_real_no_cerrar: str | None = None
    compromisos_prometidos: str | None = None
    patrones_y_mejoras: str | None = None
    # Legacy (reportes viejos)
    resumen: str | None = None
    hubo_objeciones: str | None = None
    tipo_perfil: str | None = None
    ingresos_estimados: str | None = None
    situacion_y_deseo: str | None = None
    closer_report: str | None = None
    dolores_llamada: str | None = None
    razon_compra: str | None = None
    program_offered: str | None = None
    status_llamada: str | None = None
    created_at: str
    updated_at: str | None = None


class CallReportsListResponse(BaseModel):
    call_reports: list[CallReportOut] = Field(default_factory=list)


class CallReportAnalyzeRequest(BaseModel):
    lead_id: int
    fathom_url: str


class CallReportAnalyzeResponse(BaseModel):
    report_id: int
    estado: str


class CallReportBulkIdsRequest(BaseModel):
    ids: list[int] = Field(default_factory=list)


class ClaudeApiStatusResponse(BaseModel):
    status: str
    message: str
    api_key_masked: str | None = None


class FathomApiStatusResponse(BaseModel):
    status: str
    message: str
    api_key_masked: str | None = None


PAYMENT_CONCEPTOS = ("Seña", "Saldo", "Cuota", "Otro")
PAYMENT_METODOS = ("Transferencia", "Link de pago", "Efectivo", "Otro")


class LeadPaymentOut(BaseModel):
    id: int
    lead_id: int
    monto: float
    fecha_cobro: str
    member_id: int
    member_nombre: str = ""
    concepto: str = ""
    metodo: str = ""
    comprobante_url: str | None = None
    nota: str | None = None
    created_at: str


class LeadPaymentCreateRequest(BaseModel):
    lead_id: int
    monto: float = Field(gt=0)
    fecha_cobro: date
    member_id: int
    concepto: str
    metodo: str
    comprobante_url: str | None = None
    nota: str | None = None
    precio_contrato: float | None = Field(default=None, gt=0)
    proximo_vencimiento: date | None = None


class LeadPaymentPatchRequest(BaseModel):
    monto: float | None = Field(default=None, gt=0)
    fecha_cobro: date | None = None
    member_id: int | None = None
    concepto: str | None = None
    metodo: str | None = None
    comprobante_url: str | None = None
    nota: str | None = None


class ContratoPatchRequest(BaseModel):
    precio_contrato: float | None = Field(default=None, ge=0)
    contrato_pendiente: bool | None = None


class VencimientoPatchRequest(BaseModel):
    proximo_vencimiento: date | None = None


class CobranzasLeadRow(BaseModel):
    id: str
    nombre: str
    ig: str | None = None
    telefono: str | None = None
    programa: str | None = None
    contrato: float | None = None
    contrato_fuente: str | None = None  # override | None (el catálogo es sugerencia, no manda)
    catalogo_sugerido: float | None = None
    pagado: float = 0
    debe: float | None = None
    saldo_a_favor: float = 0
    ultimo_cobro: str | None = None
    closer: str | None = None
    closer_member_id: int | None = None
    contrato_pendiente: bool = False
    proximo_vencimiento: str | None = None
    vencimiento_estado: str | None = None  # sin_fecha | vencido | proximo | al_dia


class CobranzasSummary(BaseModel):
    total_adeudado: float = 0
    total_cobrado: float = 0
    deudores: int = 0
    sin_contrato: int = 0
    vencidos: int = 0
    vencen_semana: int = 0
    leads: int = 0


class CobranzasViewResponse(BaseModel):
    summary: CobranzasSummary
    con_saldo: list[CobranzasLeadRow] = Field(default_factory=list)
    sin_contrato: list[CobranzasLeadRow] = Field(default_factory=list)


class CobranzasLeadOption(BaseModel):
    id: int
    nombre: str
    ig: str | None = None
    telefono: str | None = None
