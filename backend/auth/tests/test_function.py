import json
import logging
import sys
import types

import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from _shared import authz
from _shared.db import conn_str
from testing_support import insert_user

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
    assert body == {"id": body["id"], "email": "alex@acme.inc", "full_name": "Alex", "role": "employee",
                    "roles": ["employee"]}
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


@pytest.mark.parametrize("name,problem", [
    ("12345", "at least one letter"),
    ("Ann\u0000e", "control characters"),
    ("A" * 101, "at most 100"),
])
def test_register_rejects_names_that_are_not_names(auth, migrated_schema, name, problem):
    response, body = call(auth, "POST", "/register", {"email": "a@acme.inc", "password": PASSWORD, "full_name": name})
    assert response["statusCode"] == 400
    assert problem in body["error"]["fields"]["full_name"]


def test_register_keeps_a_hostile_looking_value_as_plain_data(auth, migrated_schema):
    # "O'Brien" carries the quote an injection needs: it must be stored verbatim, and the table must survive
    response, body = call(auth, "POST", "/register", {"email": "a@acme.inc", "password": PASSWORD,
                                                       "full_name": "Seán O'Brien-Núñez"})
    assert response["statusCode"] == 201 and body["full_name"] == "Seán O'Brien-Núñez"
    assert query("SELECT full_name FROM users") == [("Seán O'Brien-Núñez",)]


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
    assert (user.id, user.role) == (body["user"]["id"], "employee") and user.session_id
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


def test_refresh_reads_the_roles_fresh_and_keeps_the_active_one(auth, migrated_schema):
    register(auth)
    first = cookie_value(login(auth)[0])
    query_exec("INSERT INTO user_roles (user_id, role) SELECT id, 'engineer' FROM users")
    _, body = call(auth, "POST", "/refresh", cookie=first)
    # the grant shows at once; the session keeps acting as the role it had (v1.1)
    assert body["user"]["roles"] == ["employee", "engineer"] and body["user"]["role"] == "employee"


def query_exec(sql, params=()):
    with psycopg.connect(conn_str(), autocommit=True) as conn:
        conn.execute(sql, params)


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


# --- role administration (M4, AD-21) ----------------------------------------------------------

def make_user(role: str, email: str) -> int:
    with psycopg.connect(conn_str(), autocommit=True) as conn:
        return insert_user(email, email.split("@")[0], role, conn)


def token_for(auth, user_id: int, role: str) -> str:
    return auth.tokens.issue_access(authz.User(user_id, role))


@pytest.fixture
def admin(auth, migrated_schema):
    admin_id = make_user("admin", "boss@acme.inc")
    return admin_id, token_for(auth, admin_id, "admin")


def set_role(auth, token, user_id, role):
    # the single-role shape the older tests speak, as the v1.1 whole-list request
    return set_roles(auth, token, user_id, [] if role == "employee" else [role])


def set_roles(auth, token, user_id, roles):
    return call(auth, "PUT", f"/users/{user_id}/roles", {"roles": roles}, token=token)


def test_list_users_filters_by_search_and_role(auth, admin):
    make_user("employee", "ana@acme.inc")
    make_user("engineer", "bo@acme.inc")
    _, token = admin
    _, everyone = call(auth, "GET", "/users", token=token)
    assert [u["email"] for u in everyone["items"]] == ["ana@acme.inc", "bo@acme.inc", "boss@acme.inc"]
    event_q = {"rawPath": "/api/auth/users", "rawQueryString": "q=BO&role=engineer",
               "requestContext": {"http": {"method": "GET"}}, "headers": {"x-access-token": token}}
    found = json.loads(auth.handler(event_q, None)["body"])
    assert [u["email"] for u in found["items"]] == ["bo@acme.inc"]


def test_promotion_to_engineer_creates_the_profile(auth, admin):
    admin_id, token = admin
    user_id = make_user("employee", "ana@acme.inc")
    response, body = set_role(auth, token, user_id, "engineer")
    assert response["statusCode"] == 200
    assert body["user"]["role"] == "engineer"
    assert query("SELECT user_id, created_by, is_available FROM engineer_profiles") == [(user_id, admin_id, True)]


def test_demotion_unassigns_active_work_and_removes_the_profile(auth, admin):
    admin_id, token = admin
    engineer_id = make_user("employee", "eng@acme.inc")
    set_role(auth, token, engineer_id, "engineer")
    with psycopg.connect(conn_str(), autocommit=True) as conn:
        building = conn.execute("INSERT INTO buildings (name) VALUES ('HQ') RETURNING id").fetchone()[0]
        ids = [conn.execute(
            """INSERT INTO incidents (title, description, category, status, requested_priority, priority,
                                      reporter_id, assignee_id, building_id)
               VALUES ('t', 'd', 'hvac', %s, 2, 2, %s, %s, %s) RETURNING id""",
            (status, admin_id, engineer_id, building)).fetchone()[0] for status in ("in_progress", "resolved")]
    response, body = set_role(auth, token, engineer_id, "employee")
    assert response["statusCode"] == 200
    assert body["unassigned_incidents"] == [ids[0]]
    assert query("SELECT count(*) FROM engineer_profiles") == [(0,)]
    # resolved work keeps its assignee; the active ticket carries the reason in history and conversation
    assert query("SELECT id, status, assignee_id FROM incidents ORDER BY id") == [
        (ids[0], "unassigned", None), (ids[1], "resolved", engineer_id)]
    assert query("SELECT reason FROM incident_status_history") == [("assignee removed from the engineer role",)]


def test_the_last_admin_cannot_be_removed(auth, admin):
    admin_id, token = admin
    response, body = set_role(auth, token, admin_id, "employee")
    assert (response["statusCode"], body["error"]["message"]) == (409, "the last admin cannot be removed")
    assert query("SELECT role FROM user_roles WHERE user_id = %s", (admin_id,)) == [("admin",)]


def test_an_admin_can_step_down_when_another_exists(auth, admin):
    admin_id, token = admin
    second = make_user("employee", "deputy@acme.inc")
    set_role(auth, token, second, "admin")
    response, body = set_role(auth, token, admin_id, "employee")
    assert (response["statusCode"], body["user"]["role"]) == (200, "employee")


def test_same_role_is_a_no_op(auth, admin):
    _, token = admin
    user_id = make_user("employee", "ana@acme.inc")
    response, body = set_role(auth, token, user_id, "employee")
    assert (response["statusCode"], body["unassigned_incidents"]) == (200, [])


@pytest.mark.parametrize("user_id,role,status", [
    ("999999", "engineer", 404), ("not-a-number", "engineer", 404), ("{self}", "superuser", 400)])
def test_role_change_rejects_bad_input(auth, admin, user_id, role, status):
    admin_id, token = admin
    target = user_id.replace("{self}", str(admin_id))
    assert set_role(auth, token, target, role)[0]["statusCode"] == status


# --- persona access matrix (M4) ----------------------------------------------------------------

@pytest.mark.parametrize("method,path,expected", [
    # (anonymous, employee, engineer, admin)
    ("GET", "", (200, 200, 200, 200)),
    ("GET", "/me", (401, 200, 200, 200)),
    ("GET", "/users", (401, 403, 403, 200)),
    ("PUT", "/users/{target}/roles", (401, 403, 403, 200)),
])
def test_persona_access_matrix(auth, migrated_schema, method, path, expected):
    target = make_user("employee", "target@acme.inc")
    make_user("admin", "keeper@acme.inc")  # so role changes never trip the last-admin rule
    tokens = [None] + [token_for(auth, make_user(role, f"{role}@acme.inc"), role)
                       for role in ("employee", "engineer", "admin")]
    body = {"roles": []} if method == "PUT" else None
    statuses = tuple(call(auth, method, path.replace("{target}", str(target)), body, token=t)[0]["statusCode"]
                     for t in tokens)
    assert statuses == expected


def test_list_users_pages_and_rejects_bad_filters(auth, admin):
    _, token = admin
    for i in range(3):
        make_user("employee", f"p{i}@acme.inc")

    def get(query):
        event = {"rawPath": "/api/auth/users", "rawQueryString": query,
                 "requestContext": {"http": {"method": "GET"}}, "headers": {"x-access-token": token}}
        response = auth.handler(event, None)
        return response["statusCode"], json.loads(response["body"])

    status, body = get("limit=2&page=2&sort=-email")
    assert (status, body["total"], body["page"], body["limit"]) == (200, 4, 2, 2)
    assert [u["email"] for u in body["items"]] == ["p0@acme.inc", "boss@acme.inc"]
    assert get("role=superuser")[1]["error"]["fields"] == {"role": "must be one of admin, employee, engineer"}
    # a literal underscore, not a single-character wildcard
    make_user("employee", "under_score@acme.inc")
    assert [u["email"] for u in get("q=r_s")[1]["items"]] == ["under_score@acme.inc"]


# --- several roles per user (v1.1) ------------------------------------------------------------

def sign_in_as(auth, email, roles_held):
    # a real account with a real password, holding extra roles, signed in through /login
    register(auth, email=email)
    for role in roles_held:
        query_exec("INSERT INTO user_roles (user_id, role) SELECT id, %s FROM users WHERE email = %s", (role, email))
    user_id = query("SELECT id FROM users WHERE email = %s", (email,))[0][0]
    return user_id, login(auth, email=email)


def claims(token):
    return jwt.decode(token, options={"verify_signature": False})


def test_sign_in_starts_as_the_highest_role_and_lists_all(auth, migrated_schema):
    _, (response, body) = sign_in_as(auth, "multi@acme.inc", ["engineer", "admin"])
    assert body["user"]["role"] == "admin" and body["user"]["roles"] == ["employee", "engineer", "admin"]
    token_claims = claims(body["access_token"])
    assert token_claims["role"] == "admin" and token_claims["roles"] == ["employee", "engineer", "admin"]


def test_switching_role_issues_a_token_and_survives_refresh(auth, migrated_schema):
    _, (response, body) = sign_in_as(auth, "multi@acme.inc", ["engineer", "admin"])
    cookie = cookie_value(response)
    switched, switch_body = call(auth, "POST", "/active-role", {"role": "engineer"}, token=body["access_token"])
    assert switched["statusCode"] == 200 and switch_body["user"]["role"] == "engineer"
    assert authz.authenticate({"headers": {"x-access-token": switch_body["access_token"]}}).role == "engineer"
    # a reload refreshes: the session stays in the role it switched to
    _, refreshed = call(auth, "POST", "/refresh", cookie=cookie)
    assert refreshed["user"]["role"] == "engineer"


def test_switching_to_a_role_not_held_is_refused(auth, migrated_schema):
    _, (_, body) = sign_in_as(auth, "eng@acme.inc", ["engineer"])
    token = body["access_token"]
    assert call(auth, "POST", "/active-role", {"role": "admin"}, token=token)[0]["statusCode"] == 403
    assert call(auth, "POST", "/active-role", {"role": "root"}, token=token)[0]["statusCode"] == 400


def test_a_removed_active_role_falls_back_to_the_highest_held(auth, migrated_schema):
    user_id, (response, body) = sign_in_as(auth, "multi@acme.inc", ["engineer", "admin"])
    query_exec("DELETE FROM user_roles WHERE user_id = %s AND role = 'admin'", (user_id,))
    _, refreshed = call(auth, "POST", "/refresh", cookie=cookie_value(response))
    assert refreshed["user"]["role"] == "engineer"


def test_switch_without_a_session_still_answers(auth, migrated_schema):
    # a token minted before v1.1 carries no session id: the switch works, it just is not remembered
    user_id = make_user("employee", "old@acme.inc")
    response, body = call(auth, "POST", "/active-role", {"role": "employee"}, token=token_for(auth, user_id, "employee"))
    assert response["statusCode"] == 200 and body["user"]["role"] == "employee"


def test_me_reports_the_active_role(auth, migrated_schema):
    _, (_, body) = sign_in_as(auth, "multi@acme.inc", ["admin"])
    _, switched = call(auth, "POST", "/active-role", {"role": "employee"}, token=body["access_token"])
    _, me = call(auth, "GET", "/me", token=switched["access_token"])
    assert me["role"] == "employee" and me["roles"] == ["employee", "admin"]


def test_an_admin_can_grant_several_roles_at_once(auth, admin):
    admin_id, token = admin
    user_id = make_user("employee", "both@acme.inc")
    response, body = set_roles(auth, token, user_id, ["engineer", "admin", "employee"])
    assert response["statusCode"] == 200 and body["user"]["roles"] == ["employee", "engineer", "admin"]
    assert query("SELECT count(*) FROM engineer_profiles WHERE user_id = %s", (user_id,)) == [(1,)]
    # dropping admin only keeps the engineer profile and its work
    _, body = set_roles(auth, token, user_id, ["engineer"])
    assert body["user"]["roles"] == ["employee", "engineer"] and body["unassigned_incidents"] == []


def test_list_users_filters_by_held_and_missing_roles(auth, admin):
    _, token = admin
    make_user("engineer", "eng@acme.inc")
    make_user("employee", "emp@acme.inc")

    def emails(query_string):
        event = {"rawPath": "/api/auth/users", "rawQueryString": query_string,
                 "requestContext": {"http": {"method": "GET"}}, "headers": {"x-access-token": token}}
        response = auth.handler(event, None)
        return response["statusCode"], [u["email"] for u in json.loads(response["body"]).get("items", [])]

    assert emails("role=engineer") == (200, ["eng@acme.inc"])
    assert emails("role=employee")[1] == ["boss@acme.inc", "emp@acme.inc", "eng@acme.inc"]
    assert emails("lacks=engineer") == (200, ["boss@acme.inc", "emp@acme.inc"])
    assert emails("lacks=employee")[0] == 400
    assert emails("sort=-role")[1][0] == "boss@acme.inc"


def test_switch_for_a_user_that_no_longer_exists_is_404(auth, migrated_schema):
    response, _ = call(auth, "POST", "/active-role", {"role": "employee"}, token=token_for(auth, 424242, "employee"))
    assert response["statusCode"] == 404
