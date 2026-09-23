import bcrypt

# owasp floor; re-decided from a cloud measurement (AGENTS.md -> M3 build decisions)
ROUNDS = 10
MIN_LENGTH = 12
# bcrypt ignores everything past 72 bytes, so longer passwords are rejected rather than silently truncated
MAX_BYTES = 72

# an unknown email still costs one bcrypt check, so login timing does not reveal which accounts exist
_DUMMY_HASH = bcrypt.hashpw(b"timing-equaliser-not-a-password", bcrypt.gensalt(ROUNDS))


def policy_error(password: str) -> str | None:
    # nist sp 800-63b: length, no composition rules
    if len(password) < MIN_LENGTH:
        return f"must be at least {MIN_LENGTH} characters"
    if len(password.encode("utf-8")) > MAX_BYTES:
        return f"must be at most {MAX_BYTES} bytes"
    return None


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(ROUNDS)).decode("ascii")


def verify(password: str, stored_hash: str | None) -> bool:
    candidate = password.encode("utf-8")
    if stored_hash is None or len(candidate) > MAX_BYTES:
        bcrypt.checkpw(b"x", _DUMMY_HASH)
        return False
    return bcrypt.checkpw(candidate, stored_hash.encode("ascii"))
