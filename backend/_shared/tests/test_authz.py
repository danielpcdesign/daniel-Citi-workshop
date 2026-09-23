import base64
import hashlib
import hmac
import json
import logging
import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from _shared import authz
from _shared.errors import Unauthenticated


def _keypair() -> tuple[str, str]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    public = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    return private, public


PRIVATE, PUBLIC = _keypair()
OTHER_PRIVATE, _ = _keypair()


@pytest.fixture(autouse=True)
def public_key(monkeypatch):
    # terraform trims env values, so the pem arrives without its trailing newline
    monkeypatch.setenv("JWT_PUBLIC_KEY", PUBLIC.strip())


def claims(**overrides) -> dict:
    now = int(time.time())
    base = {"sub": "17", "role": "engineer", "iss": authz.ISSUER, "iat": now, "exp": now + 900}
    base.update(overrides)
    return {k: v for k, v in base.items() if v is not None}


def sign(payload: dict, key: str = PRIVATE, algorithm: str = "RS256") -> str:
    return jwt.encode(payload, key, algorithm=algorithm)


def event(token: str | None, header: str = "x-access-token") -> dict:
    return {"headers": {} if token is None else {header: token}}


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def test_valid_token_yields_the_user():
    assert authz.authenticate(event(sign(claims()))) == authz.User(17, "engineer")


def test_header_name_is_case_insensitive():
    assert authz.authenticate(event(sign(claims()), header="X-Access-Token")).id == 17


def test_missing_token():
    with pytest.raises(Unauthenticated, match="authentication required"):
        authz.authenticate(event(None))


def test_bearer_in_authorization_is_not_read():
    # authorization belongs to cloudfront's oac signature (AD-08c)
    with pytest.raises(Unauthenticated, match="authentication required"):
        authz.authenticate(event(sign(claims()), header="Authorization"))


def test_expired_token_says_expired():
    with pytest.raises(Unauthenticated, match="token expired"):
        authz.authenticate(event(sign(claims(exp=int(time.time()) - 1))))


@pytest.mark.parametrize("label,token", [
    ("signed by another key", sign(claims(), OTHER_PRIVATE)),
    ("wrong issuer", sign(claims(iss="someone-else"))),
    ("missing role", sign(claims(role=None))),
    ("missing expiry", sign(claims(exp=None))),
    ("unknown role", sign(claims(role="superuser"))),
    ("non-numeric subject", sign(claims(sub="abc"))),
    ("not a jwt at all", "definitely.not.a-token"),
])
def test_invalid_tokens_say_only_invalid(label, token):
    with pytest.raises(Unauthenticated) as caught:
        authz.authenticate(event(token))
    assert caught.value.message == "invalid token"


def test_alg_none_is_rejected():
    # an unsigned token claiming to be an admin: accepted by any verifier that trusts the header's alg
    header = b64(json.dumps({"alg": "none", "typ": "JWT"}).encode())
    body = b64(json.dumps(claims(role="admin")).encode())
    with pytest.raises(Unauthenticated, match="invalid token"):
        authz.authenticate(event(f"{header}.{body}."))


def test_rs256_to_hs256_key_confusion_is_rejected():
    # the classic attack: hmac-sign with the *public* key, hoping the verifier uses it as an hmac secret
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64(json.dumps(claims(role="admin")).encode())
    signature = hmac.new(PUBLIC.strip().encode(), f"{header}.{body}".encode(), hashlib.sha256).digest()
    with pytest.raises(Unauthenticated, match="invalid token"):
        authz.authenticate(event(f"{header}.{body}.{b64(signature)}"))


def test_precise_reason_is_logged_not_returned(caplog):
    with caplog.at_level(logging.INFO):
        with pytest.raises(Unauthenticated) as caught:
            authz.authenticate(event(sign(claims(), OTHER_PRIVATE)))
    assert "InvalidSignatureError" in caplog.text
    assert "Signature" not in caught.value.message
