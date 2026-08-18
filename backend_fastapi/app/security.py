import hmac
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException, status

from app.config import SECRET_KEY, HUB_API_KEY

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_TTL_HOURS = 8

ADMIN_ROLES = ("SUPER_ADMIN", "LCB_TEAM")


def hash_password(plain_password: str) -> str:
    """Direct bcrypt, not passlib's CryptContext — passlib 1.7.4 reads bcrypt.__about__,
    which the bcrypt package removed in 4.1+, so pwd_context.hash()/.verify() silently
    raises (and callers that catch-and-return-False see it as a hash/verify failure) on
    any environment that resolves to a current bcrypt release."""
    return bcrypt.hashpw(plain_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, stored_hash: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), stored_hash.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: int, email: str, role: str, factory_id: Optional[int]) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "factory_id": factory_id,
        "iat": now,
        "exp": now + timedelta(hours=ACCESS_TOKEN_TTL_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired. Please log in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session token.")


def _claims_to_user(claims: dict) -> dict:
    return {
        "user_id": int(claims["sub"]),
        "email": claims.get("email"),
        "role": claims.get("role"),
        "factory_id": claims.get("factory_id"),
    }


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """Extracts and verifies the bearer token every protected route depends on."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or malformed Authorization header.")
    token = authorization.removeprefix("Bearer ").strip()
    return _claims_to_user(_decode_token(token))


async def get_optional_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    """Like get_current_user, but tolerates a missing header entirely — used only for the
    one-time account-bootstrap check. A present-but-invalid token is still rejected."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ").strip()
    return _claims_to_user(_decode_token(token))


def require_roles(*roles: str):
    """Dependency factory: 403s unless the caller's token role is one of `roles`."""
    async def _check(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user["role"] not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action requires one of: {', '.join(roles)}.",
            )
        return current_user
    return _check


def assert_factory_scope(current_user: dict, factory_id) -> None:
    """PLANT_POC may only touch their own factory; admins/LCB see everything."""
    if current_user["role"] in ADMIN_ROLES:
        return
    if (
        factory_id is None
        or current_user.get("factory_id") is None
        or int(current_user["factory_id"]) != int(factory_id)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not scoped to this factory.")


async def verify_hub_key(x_hub_key: Optional[str] = Header(None)) -> None:
    """Machine-to-machine auth for the Central Hub's telemetry uploads (no user is logged in here)."""
    if not x_hub_key or not hmac.compare_digest(x_hub_key, HUB_API_KEY):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid hub key.")
