from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import OperationalError


DB_HOST="172.31.45.232"
DB_PORT="5432"
DB_NAME="scrapperbd"
DB_USER="teamsuser"
DB_PASSWORD="PgPass2026$$"

DATABASE_URL = URL.create(
    drivername="postgresql+psycopg2",
    username=DB_USER,
    password=DB_PASSWORD,
    host=DB_HOST,
    port=DB_PORT,
    database=DB_NAME,
)


# ============================================================
# Connect
# ============================================================

engine = create_engine(
    DATABASE_URL,
    connect_args={
        "connect_timeout": 10
    },
)


try:
    with engine.connect() as conn:

        print("Connected to PostgreSQL successfully.")

        result = conn.execute(
            text("""
                SELECT id, key, value, updated_at
                FROM user_preferences
                WHERE key = :key
                LIMIT 1
            """),
            {
                "key": "last_auto_scrape_timestamp"
            },
        )

        row = result.fetchone()

        if row:
            print()
            print("Result:")
            print("-----------------------------")
            print("id:", row.id)
            print("key:", row.key)
            print("value:", row.value)
            print("updated_at:", row.updated_at)
        else:
            print()
            print("No record found for:")
            print("last_auto_scrape_timestamp")


except OperationalError as e:
    print()
    print("ERROR: Could not connect to PostgreSQL.")
    print()
    print(e)


except Exception as e:
    print()
    print("ERROR:")
    print(e)