"""
database.py
===========
SQLAlchemy engine, session factory, and table-creation helper.

Set database credentials in your environment:

  DB_HOST=127.0.0.1
  DB_PORT=5432
  DB_NAME=scraper_db
  DB_USER=postgres
  DB_PASSWORD=your_password

If not set, the DB layer is silently disabled and all
scraper endpoints still work — results are saved to JSON files as before.
"""

from __future__ import annotations

import os
import logging

logger = logging.getLogger("database")


def get_psycopg2_conn():
    """Create a new raw psycopg2 connection to the PostgreSQL database."""
    import psycopg2
    return psycopg2.connect(
        host=os.environ.get("DB_HOST"),
        database=os.environ.get("DB_NAME"),
        port=int(os.environ.get("DB_PORT", 5432)),
        user=os.environ.get("DB_USER"),
        password=os.environ.get("DB_PASSWORD"),
    )


def ensure_database_exists():
    """Create the database if it doesn't exist."""
    import psycopg2
    from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

    db_name = os.environ.get("DB_NAME")
    db_user = os.environ.get("DB_USER")
    db_password = os.environ.get("DB_PASSWORD")
    db_host = os.environ.get("DB_HOST")
    db_port = os.environ.get("DB_PORT", 5432)

    try:
        conn = psycopg2.connect(
            host=db_host,
            port=int(db_port),
            user=db_user,
            password=db_password,
            database="postgres"
        )
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()

        cur.execute(f"SELECT 1 FROM pg_database WHERE datname = '{db_name}'")
        if not cur.fetchone():
            cur.execute(f'CREATE DATABASE "{db_name}"')
            print(f"[DB] Created database: {db_name}")
        
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[DB] Error creating database: {e}")


engine       = None
SessionLocal = None
Base         = None


def _get_base():
    """Lazy import of Base to avoid issues at module load time."""
    global Base
    if Base is None:
        from db_models import Base as _Base
        Base = _Base
    return Base


def _get_column_type(col):
    """Map SQLAlchemy column type to PostgreSQL type string."""
    from sqlalchemy import Integer, BigInteger, Float, Boolean, String, Text, DateTime
    t = col.type
    if isinstance(t, BigInteger): return "BIGINT"
    if isinstance(t, Integer):    return "INTEGER"
    if isinstance(t, Float):      return "DOUBLE PRECISION"
    if isinstance(t, Boolean):    return "BOOLEAN"
    if isinstance(t, String):     return f"VARCHAR({t.length or 255})"
    if isinstance(t, Text):       return "TEXT"
    if isinstance(t, DateTime):   return "TIMESTAMP WITH TIME ZONE"
    return "TEXT"


def run_migrations():
    """
    Automatically add any missing columns to existing tables.
    Safe to run on every startup — skips columns that already exist.
    """
    from sqlalchemy import text

    base = _get_base()
    with engine.connect() as conn:
        conn.execute(text("SET LOCAL search_path TO public"))
        
        for table_name, table in base.metadata.tables.items():
            table_exists = conn.execute(text("""
                SELECT 1 FROM information_schema.tables
                WHERE table_name = :table AND table_schema = 'public'
            """), {"table": table_name}).fetchone()

            if not table_exists:
                logger.info(f"Table {table_name} does not exist, skipping column check")
                continue

            for col in table.columns:
                row = conn.execute(text("""
                    SELECT data_type, character_maximum_length
                    FROM information_schema.columns
                    WHERE table_name = :table AND column_name = :column AND table_schema = 'public'
                """), {"table": table_name, "column": col.name}).fetchone()

                target_type = _get_column_type(col)

                if not row:
                    # Column missing — add it
                    conn.execute(text(
                        f'ALTER TABLE "{table_name}" ADD COLUMN "{col.name}" {target_type}'
                    ))
                    logger.info(f"Added column {table_name}.{col.name} ({target_type})")
                else:
                    # Column exists — check if it needs widening to TEXT
                    current_type = row[0].upper()
                    is_varchar   = current_type in ("CHARACTER VARYING", "VARCHAR")
                    needs_text   = target_type == "TEXT" and is_varchar
                    if needs_text:
                        conn.execute(text(
                            f'ALTER TABLE "{table_name}" ALTER COLUMN "{col.name}" TYPE TEXT'
                        ))
                        logger.info(f"Widened {table_name}.{col.name} VARCHAR → TEXT")
        conn.commit()


def init_db() -> None:
    """Create all tables if they don't exist yet. Call once at startup."""
    global engine, SessionLocal

    db_host = os.environ.get("DB_HOST")
    db_name = os.environ.get("DB_NAME")
    print(f"[DB] DB_HOST: {db_host}, DB_NAME: {db_name}")

    if not db_host or not db_name:
        print("[DB] DB credentials not set!")
        return

    try:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker

        print(f"[DB] Connecting to: {db_host}:{os.environ.get('DB_PORT')}/{db_name}")

        ensure_database_exists()

        engine = create_engine(
            "postgresql+psycopg2://", creator=get_psycopg2_conn, pool_pre_ping=True
        )
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

        base = _get_base()
        base.metadata.create_all(bind=engine)

        run_migrations()

        print(f"[DB] Database ready!")

    except Exception as exc:
        print(f"[DB] ERROR: {exc}")
        import traceback
        traceback.print_exc()
        engine       = None
        SessionLocal = None


def get_db():
    """FastAPI dependency — yields a session or raises HTTP 503."""
    from fastapi import HTTPException

    if SessionLocal is None:
        raise HTTPException(
            status_code = 503,
            detail = (
                "Database not configured. "
                "Set DATABASE_URL to enable search and persistence features."
            ),
        )
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
