import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from playwright.sync_api import Locator, Page


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value).strip()


def parse_amount(value: str | None) -> Decimal | None:
    text = clean_text(value).replace("₸", "").replace("тг", "").replace("тенге", "")
    text = re.sub(r"[^0-9,.-]", "", text).replace(" ", "")
    if not text:
        return None
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    elif "," in text:
        parts = text.split(",")
        if len(parts[-1]) == 3 and all(part.isdigit() for part in parts):
            text = "".join(parts)
        else:
            text = text.replace(",", ".")
    else:
        text = text
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def parse_datetime(value: str | None) -> datetime | None:
    text = clean_text(value)
    if not text:
        return None
    text = text.replace("T", " ")
    text = re.sub(r"(?<=\d{2}:\d{2}:\d{2})\.\d+", "", text)
    text = re.sub(r"\s*(?:Z|[+-]\d{2}:?\d{2})$", "", text)
    patterns = ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%d.%m.%Y", "%Y-%m-%d"]
    for pattern in patterns:
        try:
            return datetime.strptime(text, pattern)
        except ValueError:
            pass
    return None


def first_text(page: Page, selectors: list[str]) -> str:
    for selector in selectors:
        locator = page.locator(selector).first
        try:
            if locator.count() and locator.is_visible(timeout=1500):
                text = clean_text(locator.inner_text(timeout=2000))
                if text:
                    return text
        except Exception:
            pass
    return ""


def attr_or_empty(locator: Locator, attr: str) -> str:
    try:
        return locator.get_attribute(attr) or ""
    except Exception:
        return ""


def absolute_url(base: str, href: str) -> str:
    return urljoin(base, href)


def html_text(html: str) -> str:
    return clean_text(BeautifulSoup(html, "lxml").get_text(" "))


def find_first_regex(text: str, pattern: str) -> str | None:
    match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
    if not match:
        return None
    return match.group(1).strip()
