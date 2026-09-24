import pytest

from _shared import db


def test_conn_str_local_has_no_tls(db_env):
    assert "sslmode" not in db.conn_str()
    assert "host=172.17.0.1" in db.conn_str()


def test_conn_str_cloud_requires_tls(db_env, monkeypatch):
    monkeypatch.setenv("IS_LOCAL", "false")
    assert db.conn_str().endswith("sslmode=require")


def test_missing_variable_fails_loudly(db_env, monkeypatch):
    # no fallback credentials: a missing variable is a deploy bug, not a default (AD-04)
    monkeypatch.delenv("POSTGRES_PASS")
    with pytest.raises(KeyError, match="POSTGRES_PASS"):
        db.conn_str()


def test_connection_is_reused_across_calls(isolated_schema):
    first = db.get_conn()
    assert db.get_conn() is first
    assert first.execute("SELECT 1").fetchone() == (1,)


def test_closed_connection_is_replaced(isolated_schema):
    first = db.get_conn()
    first.close()
    assert db.get_conn() is not first


def test_reset_closes_and_forgets(isolated_schema):
    first = db.get_conn()
    db.reset_conn()
    assert first.closed
    assert db.get_conn() is not first


def test_reset_survives_a_failing_close(db_env, monkeypatch):
    class Broken:
        def close(self):
            raise RuntimeError("socket already gone")

    monkeypatch.setattr(db, "_conn", Broken())
    db.reset_conn()
    assert db._conn is None


def test_connect_timeout_waits_out_an_aurora_resume_but_not_cloudfronts(db_env):
    # resume took > 15 s in the cloud; cloudfront's default origin timeout is 30 s
    timeout = int(db.conn_str().split("connect_timeout=")[1].split()[0])
    assert 15 < timeout < 30
