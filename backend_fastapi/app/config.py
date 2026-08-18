import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base


def _require_env(name: str) -> str:
    """Fail closed: a missing secret must stop boot, never silently fall back to a baked-in default."""
    value = os.getenv(name)
    if not value or not value.strip():
        raise RuntimeError(
            f"Required environment variable '{name}' is not set. "
            f"Set it in your Vercel project settings (and locally in your shell or .env.local) before starting the app."
        )
    return value.strip()


# 1. Database connection string — no hardcoded fallback. A real production credential must
#    never live in source; if this isn't configured, the app refuses to start.
DATABASE_URL = _require_env("POSTGRES_URL_ASYNC")
if "postgresql" not in DATABASE_URL:
    raise RuntimeError("POSTGRES_URL_ASYNC does not look like a Postgres connection string.")

# 2. JWT signing secret for issuing/verifying access tokens (see app/security.py).
SECRET_KEY = _require_env("SECRET_KEY")

# 3. Shared key the Central Hub firmware presents on /api/telemetry/ingest and /acknowledge.
#    This is the only credential a Hub can offer today (it has no per-device identity), so
#    treat it like the mesh key: unique per deployment, rotated if a Hub is ever compromised.
HUB_API_KEY = _require_env("HUB_API_KEY")

# 3. Initialize the connection engine
engine = create_async_engine(DATABASE_URL, pool_pre_ping=True, echo=False)
AsyncSessionLocal = sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
Base = declarative_base()

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()