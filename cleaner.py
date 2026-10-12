import re
from typing import List, Tuple

# URL pattern matching http://, https://, www., t.me/, telegram.me/
URL_PATTERN = re.compile(
    r'(?:https?:\/\/|www\.)[^\s<>"\']+|(?:\b(?:t|telegram)\.me\/[^\s<>"\']+)',
    re.IGNORECASE
)

# Promotional phrases & common affiliate spam prefixes
PROMO_PHRASES = [
    r'join\s*(?:us|our)?\s*(?:channel|group|telegram)?',
    r'subscribe\s*(?:to)?',
    r'follow\s*(?:us)?',
    r'click\s*here',
    r'check\s*out',
]
PROMO_PATTERN = re.compile(r'|'.join(PROMO_PHRASES), re.IGNORECASE)

def clean_content(
    text: str,
    remove_links: bool = True,
    strip_signatures: bool = True,
    signatures: List[str] = None
) -> Tuple[str, bool]:
    """
    Cleans text/caption by removing visible URLs, link anchors,
    and configured signature lines while preserving coupon codes,
    emojis, and meaningful text.

    Returns: (cleaned_text, is_meaningful)
    """
    if not text:
        return "", False

    lines = text.split("\n")
    cleaned_lines = []

    for line in lines:
        stripped_line = line.strip()
        if not stripped_line:
            cleaned_lines.append("")
            continue

        # 1. Check custom signatures
        if strip_signatures and signatures:
            is_sig = False
            for sig in signatures:
                if sig and sig.strip().lower() in stripped_line.lower():
                    is_sig = True
                    break
            if is_sig:
                continue

        # 2. Remove URLs if enabled
        if remove_links:
            stripped_line = URL_PATTERN.sub("", stripped_line).strip()

        # 3. Clean up dangling promotional text if left empty or only promo
        if stripped_line:
            # Check if line was purely a promo phrase + link
            sub_promo = PROMO_PATTERN.sub("", stripped_line).strip(" :-–—•|*#@")
            if not sub_promo and len(stripped_line) < 35:
                # Discard pure promotional remnant
                continue
            cleaned_lines.append(stripped_line)
        else:
            cleaned_lines.append("")

    # Reconstruct text and collapse excessive blank lines
    result_text = "\n".join(cleaned_lines)
    result_text = re.sub(r'\n{3,}', '\n\n', result_text).strip()

    # Determine if meaningful text remains
    meaningful = bool(result_text and len(result_text.strip()) > 0)
    return result_text, meaningful
