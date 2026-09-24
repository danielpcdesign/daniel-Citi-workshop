import unicodedata

# free-text rules, written once for every service. validate on input, escape on output: the api stores what
# the person typed (parameterised sql keeps it data, react escapes it on screen), so these rules are about
# well-formed data, not about "dangerous" characters

NAME_MAX = 100
TITLE_MAX = 200
REASON_MAX = 1000
LONG_TEXT_MAX = 5000
# a person's name may use these besides letters and digits: O'Brien, Anne-Marie, J. Smith
NAME_PUNCTUATION = " '’-."


def clean(value: str, max_length: int, multiline: bool = False) -> str:
    # nfc first: "é" typed as e + combining accent and as one character must count, compare, and store the same
    value = unicodedata.normalize("NFC", value).strip()
    if not value:
        raise ValueError("must not be empty")
    if len(value) > max_length:
        raise ValueError(f"must be at most {max_length} characters")
    # control characters have no place in text people read; postgres cannot even store NUL. newlines and tabs
    # stay legal where a paragraph is expected
    allowed = "\n\t" if multiline else ""
    if any(unicodedata.category(ch) == "Cc" and ch not in allowed for ch in value):
        raise ValueError("must not contain control characters")
    return value


def optional(value: str | None, max_length: int, multiline: bool = False) -> str | None:
    # absent or blank means "not given": the caller decides whether that is allowed
    if value is None or not value.strip():
        return None
    return clean(value, max_length, multiline)


def person_name(value: str) -> str:
    value = clean(value, NAME_MAX)
    # marks (category M) belong to letters in many scripts, e.g. devanagari vowel signs
    if not any(ch.isalpha() for ch in value):
        raise ValueError("must contain at least one letter")
    for ch in value:
        if not (ch.isalpha() or ch.isdigit() or unicodedata.category(ch).startswith("M") or ch in NAME_PUNCTUATION):
            raise ValueError("may contain only letters, digits, spaces, apostrophes, hyphens and periods")
    return value
