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
import _shared.incident_ops
import _shared.listing
import _shared.log
import _shared.router
import _shared.visibility

BACKEND = Path(__file__).parent

# service code imports the vendored `shared` package; point that name at the _shared source instead,
# so tests exercise the code coverage counts and do not depend on bin/sync-shared.sh having run
sys.modules["shared"] = _shared
for _name in ("authz", "db", "errors", "http", "incident_ops", "listing", "log", "router", "visibility"):
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
    service_dir = BACKEND / name
    # a lambda imports its helper modules (passwords, tokens) as top-level names from its own dir;
    # drop helpers another service loaded, so services never see each other's modules. _shared is
    # exempt: `shared` must keep pointing at the source package, never a stale vendored copy
    for mod_name, mod in list(sys.modules.items()):
        mod_dir = Path(getattr(mod, "__file__", None) or "/").parent
        if mod_dir.parent == BACKEND and mod_dir.name != "_shared" and mod_dir != service_dir:
            del sys.modules[mod_name]
    # only this service's dir on the path, or `import shared` could find another's vendored copy
    sys.path[:] = [p for p in sys.path if Path(p).parent != BACKEND]
    sys.path.insert(0, str(service_dir))
    # every lambda's entry file is function.py, so each is loaded under a unique module name
    spec = importlib.util.spec_from_file_location(f"{name.strip('_')}_function", service_dir / "function.py")
    module = importlib.util.module_from_spec(spec)
    # registered before executing, as the importlib recipe requires: dataclasses resolve their
    # forward-referenced annotations through sys.modules[module.__name__]
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def migrated_schema(isolated_schema):
    # the real schema, applied into the throwaway schema, for services that need tables
    with psycopg.connect(_shared.db.conn_str(), autocommit=True) as conn:
        for path in sorted((BACKEND / "_migrate" / "migrations").glob("*.sql")):
            conn.execute(path.read_text())
    return isolated_schema


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
