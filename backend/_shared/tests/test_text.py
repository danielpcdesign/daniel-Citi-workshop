import pytest

from _shared import text


def test_clean_trims_and_normalises():
    # "é" as e + combining accent becomes the single character, so equal names compare equal
    assert text.clean("  Café  ", 10) == "Café"


@pytest.mark.parametrize("value,problem", [
    ("   ", "must not be empty"),
    ("x" * 11, "at most 10"),
    ("nul\x00byte", "control characters"),
    ("bell\x07", "control characters"),
    ("two\nlines", "control characters"),
])
def test_clean_rejects(value, problem):
    with pytest.raises(ValueError, match=problem):
        text.clean(value, 10)


def test_multiline_keeps_newlines_and_tabs_but_not_nul():
    assert text.clean("line one\n\tline two", 50, multiline=True) == "line one\n\tline two"
    with pytest.raises(ValueError, match="control characters"):
        text.clean("a\x00b", 50, multiline=True)


def test_optional_treats_blank_as_absent():
    assert text.optional(None, 5) is None and text.optional("  ", 5) is None
    assert text.optional(" ok ", 5) == "ok"


@pytest.mark.parametrize("name", ["Alex", "José Núñez-O'Brien", "J. R. Smith", "李雷", "Zoë", "नमस्ते", "Unit 4 Lead"])
def test_person_name_accepts_real_names(name):
    assert text.person_name(name) == name


@pytest.mark.parametrize("name,problem", [
    ("12345", "at least one letter"),
    ("...", "at least one letter"),
    ("Robert'); DROP TABLE users;--", "only letters"),
    ("<img src=x>", "only letters"),
    ("a" * 101, "at most 100"),
])
def test_person_name_rejects(name, problem):
    with pytest.raises(ValueError, match=problem):
        text.person_name(name)
