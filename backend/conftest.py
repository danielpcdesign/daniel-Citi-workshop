import importlib.util
import os
import sys
import uuid
from pathlib import Path
from types import ModuleType

import psycopg
import pytest

import _shared
import _shared.authz
import _shared.db
import _shared.errors
import _shared.http
import _shared.log
import _shared.router

BACKEND = Path(__file__).parent

# service code imports the vendored `shared` package; point that name at the _shared source instead,
# so tests exercise the code coverage counts and do not depend on bin/sync-shared.sh having run
sys.modules["shared"] = _shared
for _name in ("authz", "db", "errors", "http", "log", "router"):
    sys.modules[f"shared.{_name}"] = getattr(_shared, _name)

# the local dev database, as terraform injects it into lambdas under localstack (infra/locals.tf)
DEV_DB = {
    "POSTGRES_HOST": os.environ.get("TEST_POSTGRES_HOST", "172.17.0.1"),
    "POSTGRES_PORT": "5432",
    "POSTGRES_USER": "postgres",
    "POSTGRES_PASS": "postgres123",
    "POSTGRES_NAME": "postgres",
    "IS_LOCAL": "true",
}


def _load_service(name: str) -> ModuleType:
    # every lambda's entry file is function.py, so each is loaded under a unique module name
    path = BACKEND / name / "function.py"
    spec = importlib.util.spec_from_file_location(f"{name.strip('_')}_function", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def load_service():
    return _load_service


@pytest.fixture
def db_env(monkeypatch):
    for key, value in DEV_DB.items():
        monkeypatch.setenv(key, value)
    _shared.db.reset_conn()
    yield
    _shared.db.reset_conn()


@pytest.fixture
def isolated_schema(db_env, monkeypatch):
    # a throwaway schema inside the dev database: tests create and break tables there, never in public
    schema = f"test_{uuid.uuid4().hex[:12]}"
    admin = psycopg.connect(_shared.db.conn_str(), autocommit=True)
    try:
        admin.execute(f'CREATE SCHEMA "{schema}"')
    except psycopg.OperationalError as e:
        pytest.skip(f"dev database unreachable: {e}")
    # libpq reads PGOPTIONS on every new connection, so code under test lands in the schema unchanged
    monkeypatch.setenv("PGOPTIONS", f"-c search_path={schema}")
    try:
        yield schema
    finally:
        _shared.db.reset_conn()
        admin.execute(f'DROP SCHEMA "{schema}" CASCADE')
        admin.close()
