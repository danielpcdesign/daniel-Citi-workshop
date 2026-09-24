import time

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

# test-only helpers shared by every service's tests, so the signing setup is written once (not a lambda module)
_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PRIVATE = _KEY.private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
).decode()
PUBLIC = _KEY.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
).decode()
ISSUER = "acme-incidents-auth"


def token(user_id: int, role: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {"sub": str(user_id), "role": role, "iss": ISSUER, "iat": now, "exp": now + 900}, PRIVATE, algorithm="RS256"
    )


def insert_user(email: str, full_name: str, role: str = "employee", conn=None) -> int:
    # v1.1: employee is implicit; any other role is a user_roles row. opens its own connection unless given one
    import psycopg

    from _shared.db import conn_str

    if conn is None:
        with psycopg.connect(conn_str(), autocommit=True) as own:
            return insert_user(email, full_name, role, own)
    (user_id,) = conn.execute(
        "INSERT INTO users (email, password_hash, full_name) VALUES (%s, 'x', %s) RETURNING id", (email, full_name)
    ).fetchone()
    if role != "employee":
        conn.execute("INSERT INTO user_roles (user_id, role) VALUES (%s, %s)", (user_id, role))
    return user_id
