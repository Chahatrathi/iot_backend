import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base

# 1. Capture the system environment variable
DATABASE_URL = os.getenv("POSTGRES_URL_ASYNC")

# 2. FAIL-SAFE: If Vercel gives an invalid string or can't read the variable, drop back to your local connection string
if not DATABASE_URL or "postgresql" not in DATABASE_URL:
    DATABASE_URL = "postgresql+asyncpg://postgres:artirathi123@iot-production-db.crioe28ugmeh.ap-south-1.rds.amazonaws.com:5432/postgres"

# Clean any whitespace or formatting anomalies that could confuse the SQLAlchemy parser
DATABASE_URL = DATABASE_URL.strip()

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