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
