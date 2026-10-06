import re


def clean_isbn(value: str | None) -> str:
    return re.sub(r"[^0-9X]", "", (value or "").upper())


def isbn13_check_digit(first_twelve: str) -> str:
    total = sum(int(char) * (1 if index % 2 == 0 else 3) for index, char in enumerate(first_twelve))
    return str((10 - total % 10) % 10)


def canonical_isbn(value: str | None) -> str | None:
    cleaned = clean_isbn(value)
    if len(cleaned) == 13 and cleaned.startswith(("978", "979")):
        return cleaned if isbn13_check_digit(cleaned[:12]) == cleaned[-1] else None
    if len(cleaned) != 10:
        return None
    total = 0
    for index, char in enumerate(cleaned):
        digit = 10 if char == "X" and index == 9 else int(char) if char.isdigit() else -1
        if digit < 0:
            return None
        total += (10 - index) * digit
    if total % 11:
        return None
    first_twelve = "978" + cleaned[:9]
    return first_twelve + isbn13_check_digit(first_twelve)
