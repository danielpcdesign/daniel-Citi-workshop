from .errors import ValidationFailed

# AD-13: page-number pagination with a hard ceiling
DEFAULT_LIMIT = 20
MAX_LIMIT = 100


def first(query: dict[str, list[str]], name: str) -> str | None:
    values = query.get(name)
    return values[0] if values else None


def paging(query: dict[str, list[str]]) -> tuple[int, int, int]:
    errors = {}
    page = _positive_int(first(query, "page"), 1, "page", errors)
    limit = _positive_int(first(query, "limit"), DEFAULT_LIMIT, "limit", errors)
    if "limit" not in errors and limit > MAX_LIMIT:
        errors["limit"] = f"must be at most {MAX_LIMIT}"
    if errors:
        raise ValidationFailed("invalid paging", errors)
    return page, limit, (page - 1) * limit


def _positive_int(raw: str | None, default: int, name: str, errors: dict) -> int:
    if raw is None:
        return default
    if not raw.isdigit() or int(raw) < 1:
        errors[name] = "must be a positive whole number"
        return default
    return int(raw)


# `sort=-priority,created_at`: each key must be in the allow-list, which maps it to a fixed sql expression,
# so nothing from the request is ever interpolated into sql
def order_by(query: dict[str, list[str]], allowed: dict[str, str], default: str) -> str:
    raw = first(query, "sort") or default
    parts = []
    for key in (k.strip() for k in raw.split(",") if k.strip()):
        descending = key.startswith("-")
        name = key.lstrip("-")
        if name not in allowed:
            raise ValidationFailed("invalid sort", {"sort": f"unknown key {name!r}; allowed: {', '.join(sorted(allowed))}"})
        parts.append(f"{allowed[name]} {'DESC' if descending else 'ASC'}")
    # id last: a stable total order, so a row never shows up on two pages or on none
    parts.append("id ASC")
    return ", ".join(parts)


def envelope(items: list, total: int, page: int, limit: int) -> dict:
    return {"items": items, "total": total, "page": page, "limit": limit}
