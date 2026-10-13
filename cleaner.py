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
    signatures: List[str] = None,
    source_handle: str = None
) -> Tuple[str, bool]:
    """
    Cleans text/caption by removing visible URLs, link anchors,
    source channel handles, and configured signature lines while preserving
    coupon codes, quotes, emojis, and meaningful text.

    Returns: (cleaned_text, is_meaningful)
    """
    if not text:
        return "", False

    # Prepare full list of signatures including source handle (e.g. @Quotes)
    sig_list = list(signatures or [])
    if source_handle:
        handle = source_handle.strip()
        if handle and handle not in sig_list:
            sig_list.append(handle)
        if handle.startswith("@") and handle[1:] not in sig_list:
            sig_list.append(handle[1:])

    lines = text.split("\n")
    cleaned_lines = []

    for line in lines:
        stripped_line = line.strip()
        if not stripped_line:
            cleaned_lines.append("")
            continue

        # 1. Check custom signatures and source channel handles
        if strip_signatures and sig_list:
            is_sig = False
            for sig in sig_list:
                if sig and sig.strip().lower() in stripped_line.lower():
                    # If the line is short (like "🖌 @Quotes 🐉" or "Join @Quotes"), remove the whole line
                    if len(stripped_line) < 60:
                        is_sig = True
                        break
                    else:
                        # Remove just the signature/handle occurrence inside a longer line
                        stripped_line = re.sub(re.escape(sig.strip()), "", stripped_line, flags=re.IGNORECASE).strip()
            if is_sig:
                continue

        # 2. Remove URLs if enabled
        if remove_links:
            stripped_line = URL_PATTERN.sub("", stripped_line).strip()

        # 3. Clean up dangling promotional text if left empty or only promo
        if stripped_line:
            sub_promo = PROMO_PATTERN.sub("", stripped_line).strip(" :-–—•|*#@")
            if not sub_promo and len(stripped_line) < 35:
                continue
            cleaned_lines.append(stripped_line)
        else:
            cleaned_lines.append("")

    # Reconstruct text and collapse excessive blank lines
    result_text = "\n".join(cleaned_lines)
    result_text = re.sub(r'\n{3,}', '\n\n', result_text).strip()

    # Determine if meaningful text remains (ignore lines that are only divider lines like ━━━━━━━)
    alpha_num_check = re.sub(r'[\W_]+', '', result_text)
    meaningful = bool(alpha_num_check and len(alpha_num_check) > 1)
    return result_text, meaningful
