import re
from typing import List, Tuple

# URL pattern matching http://, https://, www., t.me/, telegram.me/
URL_PATTERN = re.compile(
    r'(?:https?:\/\/|www\.)[^\s<>"\']+|(?:\b(?:t|telegram)\.me\/[^\s<>"\']+)',
    re.IGNORECASE
)

# Telegram @username / channel handle pattern (e.g. @NotesHub_Ssc, @Quotes, etc.)
HANDLE_PATTERN = re.compile(r'@[A-Za-z0-9_]{3,}', re.IGNORECASE)

# Markdown link pattern [anchor text](https://...)
MARKDOWN_LINK_PATTERN = re.compile(r'\[([^\]]+)\]\((?:https?:\/\/|t\.me\/)[^\)]+\)', re.IGNORECASE)

# Promotional phrases & common affiliate spam prefixes
PROMO_PHRASES = [
    r'join\s*(?:us|our)?\s*(?:channel|group|telegram)?',
    r'subscribe\s*(?:to)?',
    r'follow\s*(?:us)?',
    r'click\s*here',
    r'check\s*out',
    r'shared\s*by',
    r'credit\s*:',
    r'source\s*:',
    r'uploaded\s*by',
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
    Cleans text/caption by removing:
    1. All visible URLs (http://, https://, www., t.me/, telegram.me/)
    2. All Telegram @usernames / channel handles (e.g. @NotesHub_Ssc, @Quotes)
    3. Configured custom signature phrases
    4. Promotional lines left empty after handle/link removal

    Returns: (cleaned_text, is_meaningful)
    """
    if not text:
        return "", False

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

        # 1. Check custom configured signatures
        if strip_signatures and sig_list:
            is_sig = False
            for sig in sig_list:
                if sig and sig.strip().lower() in stripped_line.lower():
                    if len(stripped_line) < 60:
                        is_sig = True
                        break
                    else:
                        stripped_line = re.sub(re.escape(sig.strip()), "", stripped_line, flags=re.IGNORECASE).strip()
            if is_sig:
                continue

        # 2. Remove URLs and @Usernames if remove_links is enabled
        if remove_links:
            # Remove markdown links completely if they are short promo anchors, else keep text
            stripped_line = MARKDOWN_LINK_PATTERN.sub("", stripped_line)
            # Remove raw URLs
            stripped_line = URL_PATTERN.sub("", stripped_line)
            # Remove ALL @username handles (e.g. @NotesHub_Ssc, @Quotes, etc.)
            stripped_line = HANDLE_PATTERN.sub("", stripped_line).strip()

        # 3. Clean up dangling promotional text or lines that became empty/only emojis
        if stripped_line:
            # Strip leftover promo words and decorative symbols to see if real words remain
            sub_promo = PROMO_PATTERN.sub("", stripped_line)
            # Check if only symbols/emojis remain on a line that originally had a @handle or URL
            had_handle_or_url = bool(HANDLE_PATTERN.search(line) or URL_PATTERN.search(line))
            alpha_num_remaining = re.sub(r'[\W_]+', '', sub_promo)

            if had_handle_or_url and len(alpha_num_remaining) < 3:
                # Line was something like "🖌 @Quotes 🐉" or "👉 @NotesHub_Ssc" -> drop entire line
                continue

            if not alpha_num_remaining and len(stripped_line) < 35 and had_handle_or_url:
                continue

            cleaned_lines.append(stripped_line)
        else:
            cleaned_lines.append("")

    # Reconstruct text and collapse excessive blank lines
    result_text = "\n".join(cleaned_lines)
    result_text = re.sub(r'\n{3,}', '\n\n', result_text).strip()

    # Also remove trailing divider lines (e.g. ━━━━━━━━━━━) if they were only separating a signature at the bottom
    result_lines = result_text.split("\n")
    while result_lines:
        last_l = result_lines[-1].strip()
        if not last_l or re.match(r'^[\u2500-\u257F\-_=\*~•]+$', last_l):
            result_lines.pop()
        else:
            break
    result_text = "\n".join(result_lines).strip()

    # Determine if meaningful text remains
    alpha_num_check = re.sub(r'[\W_]+', '', result_text)
    meaningful = bool(alpha_num_check and len(alpha_num_check) > 1)
    return result_text, meaningful
