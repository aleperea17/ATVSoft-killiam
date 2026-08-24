from datetime import datetime, timedelta, timezone

import bcrypt
from decouple import config
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pony.orm import count, db_session

from src.models import AuthUser
from src.schemas import (
    AuthChangePasswordRequest,
    AuthLoginRequest,
    AuthMeResponse,
    AuthRegisterRequest,
    AuthSetupStatusResponse,
    AuthTokenResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

JWT_SECRET = config("JWT_SECRET", default="change-this-secret")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = config("JWT_EXPIRE_MINUTES", cast=int, default=60 * 24)
REGISTER_ADMIN_KEY = config("REGISTER_ADMIN_KEY", default="change-this-register-key")
REGISTER_KEY_PLACEHOLDER = "change-this-register-key"


def _register_admin_key() -> str:
    return (str(REGISTER_ADMIN_KEY) if REGISTER_ADMIN_KEY is not None else "").strip()


def _admin_key_is_configured() -> bool:
    key = _register_admin_key()
    return bool(key) and key != REGISTER_KEY_PLACEHOLDER


def _user_count() -> int:
    return int(count(u for u in AuthUser))


def _create_access_token(username: str, user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {"sub": username, "user_id": user_id, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


@router.get("/setup-status", response_model=AuthSetupStatusResponse)
def setup_status() -> AuthSetupStatusResponse:
    with db_session:
        empty = _user_count() == 0
    return AuthSetupStatusResponse(
        needs_setup=empty,
        extra_signup_allowed=_admin_key_is_configured(),
    )


@router.post("/register", response_model=AuthTokenResponse)
def register_user(
    body: AuthRegisterRequest,
):
    username = body.username.strip()
    password = body.password
    if not username or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Usuario y contraseña son obligatorios",
        )
    if len(password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La contraseña debe tener al menos 6 caracteres",
        )

    with db_session:
        empty = _user_count() == 0
        if not empty:
            if not _admin_key_is_configured():
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="El registro de usuarios adicionales está cerrado.",
                )
            provided = (body.admin_key or "").strip()
            if provided != _register_admin_key():
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Clave de administrador inválida.",
                )

        existing = AuthUser.get(username=username)
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ese usuario ya existe")

        password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        user = AuthUser(username=username, password_hash=password_hash, updated_at=datetime.utcnow())
        user.flush()
        uid = user.id
        from src.services.avatars_services import seed_default_avatars_for_user

        seed_default_avatars_for_user(uid)

    return AuthTokenResponse(access_token=_create_access_token(username, uid), user_id=uid)


@router.post("/login", response_model=AuthTokenResponse)
def login_user(body: AuthLoginRequest):
    username = body.username.strip()
    password = body.password
    if not username or not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="username and password are required")

    with db_session:
        user = AuthUser.get(username=username)
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        valid_password = bcrypt.checkpw(password.encode("utf-8"), user.password_hash.encode("utf-8"))
        if not valid_password:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        uid = user.id

    return AuthTokenResponse(access_token=_create_access_token(username, uid), user_id=uid)


def get_current_username(token: str = Depends(oauth2_scheme)) -> str:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return username
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc


def get_current_user_id(username: str = Depends(get_current_username)) -> int:
    with db_session:
        user = AuthUser.get(username=username)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        return user.id


@router.get("/me", response_model=AuthMeResponse)
def me(
    username: str = Depends(get_current_username),
    user_id: int = Depends(get_current_user_id),
):
    return AuthMeResponse(username=username, user_id=user_id)


@router.post("/change-password", response_model=AuthTokenResponse)
def change_password(
    body: AuthChangePasswordRequest,
    username: str = Depends(get_current_username),
):
    """Cambia la contraseña del usuario logueado verificando la contraseña actual."""
    current_password = body.current_password or ""
    new_password = body.new_password or ""
    if len(new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La nueva contraseña debe tener al menos 6 caracteres",
        )

    with db_session:
        user = AuthUser.get(username=username)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

        valid_current = bcrypt.checkpw(
            current_password.encode("utf-8"),
            user.password_hash.encode("utf-8"),
        )
        if not valid_current:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Contraseña actual incorrecta",
            )

        user.password_hash = bcrypt.hashpw(
            new_password.encode("utf-8"), bcrypt.gensalt()
        ).decode("utf-8")
        user.updated_at = datetime.utcnow()
        uid = user.id

    return AuthTokenResponse(
        access_token=_create_access_token(username, uid),
        user_id=uid,
    )
