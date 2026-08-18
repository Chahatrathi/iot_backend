# -*- coding: utf-8 -*-
"""Apply migrations/migrations/*.sql to the SaaS Postgres database, in filename order.

Run against the same database the FastAPI app uses (POSTGRES_URL_ASYNC). Every file
under migrations/ is executed inside its own transaction, and applied files are
recorded in a schema_migrations table so re-running is a no-op for everything that
already ran. Files are assumed to be idempotent (the invoicing ones are written as
INSERT ... ON CONFLICT / CREATE TABLE IF NOT EXISTS).

Usage:
    python scripts/apply_migrations.py                     # use POSTGRES_URL_ASYNC from env/.env
    python scripts/apply_migrations.py --url postgresql://... --dry-run
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
MIGRATIONS_DIR = BACKEND_DIR / "migrations"

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


def load_env():
    """Load backend .env / .env.local if present (harmless if neither exists)."""
    if load_dotenv is None:
        return
    for name in (".env.local", ".env"):
        path = BACKEND_DIR / name
        if path.exists():
            load_dotenv(path, override=False)


def get_db_url(override: str | None) -> str:
    if override:
        return override
    url = os.getenv("POSTGRES_URL_ASYNC")
    if not url or "postgresql" not in url:
        sys.exit(
            "POSTGRES_URL_ASYNC is not set. Pass --url, or create a .env / .env.local "
            "in backend_fastapi/ with POSTGRES_URL_ASYNC=postgresql+asyncpg://... "
            "(the same variable the app requires)."
        )
    return url


async def run(sql_url: str, dry_run: bool):
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    engine = create_async_engine(sql_url, pool_pre_ping=True)

    applied = set()
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                "    filename TEXT PRIMARY KEY,"
                "    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
                ");"
            ))
            applied = set((await conn.execute(
                text("SELECT filename FROM schema_migrations;")
            )).scalars())
    except Exception as e:
        if dry_run:
            # Offline dry-run: can't know what ran, so report everything as pending.
            print(f"NOTE: could not read schema_migrations ({e}); listing all files.\n")
        else:
            raise

    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        sys.exit(f"No .sql files found in {MIGRATIONS_DIR}")

    pending = [f for f in files if f.name not in applied]
    print(f"Migration dir: {MIGRATIONS_DIR}")
    print(f"Found {len(files)} migration file(s); {len(applied)} applied, {len(pending)} pending.\n")

    if dry_run:
        for f in pending:
            print(f"  WOULD APPLY  {f.name}")
        return

    if not pending:
        print("Nothing to do — database is up to date.")
        return

    for f in pending:
        sql = f.read_text(encoding="utf-8")
        print(f"  APPLYING {f.name} ({len(sql.splitlines())} lines)...")
        async with engine.begin() as conn:  # one transaction per file
            await conn.execute(text(sql))
            await conn.execute(
                text("INSERT INTO schema_migrations (filename) VALUES (:f)"),
                {"f": f.name},
            )
        print(f"  OK       {f.name}")
    print("\nDone.")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--url", default=None,
                    help="postgresql+asyncpg:// connection string (default: POSTGRES_URL_ASYNC env)")
    ap.add_argument("--dry-run", action="store_true", help="list pending files without applying")
    args = ap.parse_args()

    load_env()
    url = get_db_url(args.url)
    asyncio.run(run(url, args.dry_run))


if __name__ == "__main__":
    main()
