import json
import logging
import sys
import types

import psycopg
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from _shared import authz
from _shared.db import conn_str

PASSWORD = "correct horse battery"


def _keypair() -> tuple[str, str]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()
    ).decode()
    public = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    return private, public


PRIVATE, PUBLIC = _keypair()


@pytest.fixture
def auth(load_service, monkeypatch):
    # the same shape terraform produces locally (infra/jwt.tf): private key for auth, public key for all
    monkeypatch.setenv("JWT_PRIVATE_KEY", PRIVATE.strip())
    monkeypatch.setenv("JWT_PUBLIC_KEY", PUBLIC.strip())
    module = load_service("auth")
    module.tokens._signing_key = None
    return module


def call(auth, method, path, body=None, cookie=None, token=None, aws_cookies=False):
    headers = {}
    if token:
        headers["x-access-token"] = token
    event = {
        "rawPath": f"/api/auth{path}",
        "requestContext": {"http": {"method": method}},
        "headers": headers,
        "body": None if body is None else json.dumps(body),
    }
    if cookie:
        # aws delivers cookies as a list; localstack leaves them in the cookie header
        if aws_cookies:
            event["cookies"] = [cookie]
        else:
            headers["cookie"] = f"other=1; {cookie}"
    response = auth.handler(event, None)
    parsed = json.loads(response["body"]) if response["body"] else None
    return response, parsed


def query(sql, params=()):
    with psycopg.connect(conn_str(), autocommit=True) as conn:
        return conn.execute(sql, params).fetchall()


def cookie_value(response) -> str:
    # "refresh_token=<value>; HttpOnly; ..." -> "refresh_token=<value>"
    return response["cookies"][0].split(";")[0]


def register(auth, email="alex@acme.inc", password=PASSWORD):
    return call(auth, "POST", "/register", {"email": email, "password": password, "full_name": "Alex"})


def login(auth, email="alex@acme.inc", password=PASSWORD):
    return call(auth, "POST", "/login", {"email": email, "password": password})


# --- registration (AD-21) -------------------------------------------------------------------

def test_register_creates_an_employee_and_ignores_a_requested_role(auth, migrated_schema):
    response, body = call(auth, "POST", "/register", {
        "email": "  Alex@ACME.inc ", "password": PASSWORD, "full_name": " Alex ", "role": "admin"})
    assert response["statusCode"] == 201
    assert body == {"id": body["id"], "email": "alex@acme.inc", "full_name": "Alex", "role": "employee"}
    stored = query("SELECT password_hash FROM users")[0][0]
    assert stored.startswith("$2b$10$") and PASSWORD not in stored


@pytest.mark.parametrize("email", ["x@acme.inc.evil.com", "x@notacme.inc", "x@mail.acme.inc", "acme.inc", "@acme.inc"])
def test_register_rejects_other_domains(auth, migrated_schema, email):
    response, body = register(auth, email=email)
    assert response["statusCode"] == 400
    assert "email" in body["error"]["fields"]


@pytest.mark.parametrize("password,problem", [
    ("short", "at least 12"),
    ("é" * 37, "at most 72 bytes"),  # 37 characters, 74 bytes: bcrypt would silently drop the tail
])
def test_register_enforces_the_password_policy(auth, migrated_schema, password, problem):
    response, body = register(auth, password=password)
    assert response["statusCode"] == 400
    assert problem in body["error"]["fields"]["password"]


def test_register_rejects_a_blank_name(auth, migrated_schema):
    response, body = call(auth, "POST", "/register", {"email": "a@acme.inc", "password": PASSWORD, "full_name": "  "})
    assert body["error"]["fields"] == {"full_name": "Value error, must not be empty"}


def test_duplicate_registration_is_conflict(auth, migrated_schema):
    register(auth)
    response, body = register(auth, email="ALEX@acme.inc")
    assert response["statusCode"] == 409
    assert body["error"]["message"] == "that email is already registered"


# --- login ----------------------------------------------------------------------------------

def test_login_returns_a_verifiable_access_token_and_a_locked_down_cookie(auth, migrated_schema):
    register(auth)
    response, body = login(auth, email="ALEX@acme.inc")
    assert response["statusCode"] == 200
    assert body["expires_in"] == 900
    user = authz.authenticate({"headers": {"x-access-token": body["access_token"]}})
    assert user == authz.User(body["user"]["id"], "employee")
    cookie = response["cookies"][0]
    for attribute in ("HttpOnly", "Secure", "SameSite=Strict", "Path=/api/auth/refresh", "Max-Age=604800"):
        assert attribute in cookie
    # the same cookie as a header, because localstack ignores the cookies field
    assert response["headers"]["Set-Cookie"] == cookie


def test_wrong_password_and_unknown_email_look_identical(auth, migrated_schema, monkeypatch):
    register(auth)
    checks = []
    real_checkpw = auth.passwords.bcrypt.checkpw
    monkeypatch.setattr(auth.passwords.bcrypt, "checkpw", lambda *a: checks.append(1) or real_checkpw(*a))
    wrong, wrong_body = login(auth, password="wrong password!!")
    unknown, unknown_body = login(auth, email="nobody@acme.inc")
    assert wrong["statusCode"] == unknown["statusCode"] == 401
    assert wrong_body["error"]["message"] == unknown_body["error"]["message"] == "invalid email or password"
    # an unknown email still pays one bcrypt check, so timing does not reveal which accounts exist
    assert checks == [1, 1]


def test_over_long_password_fails_login_without_truncation(auth, migrated_schema):
    register(auth)
    response, _ = login(auth, password=PASSWORD + "x" * 80)
    assert response["statusCode"] == 401


# --- /me (AD-09) ------------------------------------------------------------------------------

def test_me_requires_a_token(auth, migrated_schema):
    assert call(auth, "GET", "/me")[0]["statusCode"] == 401


def test_me_returns_the_caller(auth, migrated_schema):
    register(auth)
    _, body = login(auth)
    response, me = call(auth, "GET", "/me", token=body["access_token"])
    assert response["statusCode"] == 200
    assert me["email"] == "alex@acme.inc"


def test_me_for_a_user_that_no_longer_exists(auth, migrated_schema):
    token = auth.tokens.issue_access(authz.User(999999, "employee"))
    assert call(auth, "GET", "/me", token=token)[0]["statusCode"] == 404


# --- refresh rotation and reuse detection (AD-07d) ------------------------------------------

def test_refresh_rotates_the_token(auth, migrated_schema):
    register(auth)
    first = cookie_value(login(auth)[0])
    response, body = call(auth, "POST", "/refresh", cookie=first)
    assert response["statusCode"] == 200
    second = cookie_value(response)
    assert second != first
    assert authz.authenticate({"headers": {"x-access-token": body["access_token"]}}).role == "employee"
    assert query("SELECT count(*) FROM refresh_tokens WHERE revoked_at IS NOT NULL") == [(1,)]


def test_aws_cookie_list_shape_is_read(auth, migrated_schema):
    register(auth)
    first = cookie_value(login(auth)[0])
    assert call(auth, "POST", "/refresh", cookie=first, aws_cookies=True)[0]["statusCode"] == 200


def test_reusing_a_rotated_token_revokes_the_whole_family(auth, migrated_schema, caplog):
    register(auth)
    first = cookie_value(login(auth)[0])
    second = cookie_value(call(auth, "POST", "/refresh", cookie=first)[0])
    with caplog.at_level(logging.WARNING):
        reused, body = call(auth, "POST", "/refresh", cookie=first)
    assert reused["statusCode"] == 401
    assert body["error"]["message"] == "invalid session"
    assert "reuse detected" in caplog.text
    # the legitimate holder's newer token dies too: the revocation must survive the 401 (not rolled back)
    assert call(auth, "POST", "/refresh", cookie=second)[0]["statusCode"] == 401
    assert query("SELECT count(*) FROM refresh_tokens WHERE revoked_at IS NULL") == [(0,)]


def test_expired_refresh_token(auth, migrated_schema):
    register(auth)
    first = cookie_value(login(auth)[0])
    query_exec = psycopg.connect(conn_str(), autocommit=True)
    query_exec.execute("UPDATE refresh_tokens SET expires_at = now() - interval '1 second'")
    query_exec.close()
    response, body = call(auth, "POST", "/refresh", cookie=first)
    assert (response["statusCode"], body["error"]["message"]) == (401, "session expired")


@pytest.mark.parametrize("cookie,message", [(None, "no session"), ("refresh_token=forged", "invalid session")])
def test_refresh_without_a_valid_cookie(auth, migrated_schema, cookie, message):
    response, body = call(auth, "POST", "/refresh", cookie=cookie)
    assert (response["statusCode"], body["error"]["message"]) == (401, message)


def test_refresh_reads_the_role_fresh(auth, migrated_schema):
    register(auth)
    first = cookie_value(login(auth)[0])
    conn = psycopg.connect(conn_str(), autocommit=True)
    conn.execute("UPDATE users SET role = 'engineer'")
    conn.close()
    _, body = call(auth, "POST", "/refresh", cookie=first)
    assert authz.authenticate({"headers": {"x-access-token": body["access_token"]}}).role == "engineer"


# --- sign-out (DELETE /refresh) -------------------------------------------------------------

def test_sign_out_revokes_server_side_and_clears_the_cookie(auth, migrated_schema):
    register(auth)
    first = cookie_value(login(auth)[0])
    response, _ = call(auth, "DELETE", "/refresh", cookie=first)
    assert response["statusCode"] == 204
    assert "Max-Age=0" in response["cookies"][0]
    # clearing the cookie alone would protect nobody: the token itself is dead
    assert call(auth, "POST", "/refresh", cookie=first)[0]["statusCode"] == 401


@pytest.mark.parametrize("cookie", [None, "refresh_token=forged"])
def test_sign_out_is_idempotent(auth, migrated_schema, cookie):
    assert call(auth, "DELETE", "/refresh", cookie=cookie)[0]["statusCode"] == 204


# --- key handling (AD-07b) --------------------------------------------------------------------

def test_cloud_reads_the_key_from_secrets_manager_once(auth, monkeypatch):
    monkeypatch.delenv("JWT_PRIVATE_KEY")
    monkeypatch.setenv("JWT_SECRET_NAME", "coding-workshop-jwt-signing-test")
    fetches = []

    class Client:
        def get_secret_value(self, SecretId):
            fetches.append(SecretId)
            return {"SecretString": PRIVATE}

    monkeypatch.setitem(sys.modules, "boto3", types.SimpleNamespace(client=lambda name: Client()))
    auth.tokens.issue_access(authz.User(1, "admin"))
    auth.tokens.issue_access(authz.User(2, "admin"))
    # cached at module scope: one secrets manager call per warm container, not per request
    assert fetches == ["coding-workshop-jwt-signing-test"]


def test_health(auth, migrated_schema):
    response, body = call(auth, "GET", "")
    assert (response["statusCode"], body) == (200, {"service": "auth", "database": "ok"})
