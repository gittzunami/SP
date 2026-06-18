"""
keyword_utils.py
================
Shared fuzzy keyword matching used by all scrapers.

Per keyword word, match is attempted in order:
  1. Exact / substring match
  2. Stemmed match  — common English suffix stripping
  3. Phonetic match — Soundex (words ≥ 4 chars)
  4. Typo tolerance — Levenshtein ≤ 1 (word len ≥ 5), ≤ 2 (word len ≥ 8)

Partial phrase matching (not ALL words required):
  1–2 meaningful words → all must match
  3   meaningful words → 2 must match
  4   meaningful words → 3 must match
  5+  meaningful words → ceil(60%) must match

Example:
  keyword = "cloud to cloud data transfer service"
  meaningful unique words = [cloud, data, transfer, service]  → 4 words
  required = 3
  text "cloud data transfer" → matches cloud, data, transfer → 3/4  ✓
  text "cloud to cloud data transfer" → same → 3/4  ✓
"""

import math
import re
import unicodedata
from typing import List, Set

# ── Stop words ────────────────────────────────────────────────────────────────

STOP_WORDS: Set[str] = {
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "it", "its", "this", "that", "these",
    "those", "as", "up", "out", "about", "into", "then", "than", "so",
    "not", "no", "can", "if", "we", "you", "they", "he", "she", "i",
}


# ── Normalise ─────────────────────────────────────────────────────────────────

def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text.lower()).strip()


# ── Stemmer (basic suffix stripping) ─────────────────────────────────────────

# Ordered longest-first so more specific rules win
_SUFFIXES = [
    ("izations", ""), ("isations", ""), ("ization", ""),  ("isation", ""),
    ("nesses",   ""), ("ments",    ""), ("tions",   ""),  ("ities",   ""),
    ("ings",     ""), ("edly",     ""), ("ingly",   ""),
    ("ness",     ""), ("ment",     ""), ("tion",    ""),
    ("ings",     ""), ("ing",      ""), ("ies",     "y"),  ("ied",     "y"),
    ("ers",      ""), ("ized",     ""), ("ised",    ""),
    ("ful",      ""), ("ous",      ""), ("ive",     ""),
    ("al",       ""), ("ic",       ""),
    ("ed",       ""), ("er",       ""), ("ly",      ""),
    ("s",        ""),
]


def _stem(word: str) -> str:
    if len(word) <= 3:
        return word
    for suffix, replacement in _SUFFIXES:
        if word.endswith(suffix):
            root = word[: len(word) - len(suffix)] + replacement
            if len(root) >= 3:
                return root
    return word


# ── Soundex ───────────────────────────────────────────────────────────────────

_SOUNDEX_CODES = {
    'B': '1', 'F': '1', 'P': '1', 'V': '1',
    'C': '2', 'G': '2', 'J': '2', 'K': '2', 'Q': '2', 'S': '2', 'X': '2', 'Z': '2',
    'D': '3', 'T': '3',
    'L': '4',
    'M': '5', 'N': '5',
    'R': '6',
}


def _soundex(word: str) -> str:
    word = re.sub(r"[^A-Za-z]", "", word).upper()
    if not word:
        return "0000"
    result = word[0]
    prev   = _SOUNDEX_CODES.get(word[0], "0")
    for c in word[1:]:
        code = _SOUNDEX_CODES.get(c, "0")
        if code != "0" and code != prev:
            result += code
        prev = code
        if len(result) == 4:
            break
    return result.ljust(4, "0")


# ── Levenshtein distance ──────────────────────────────────────────────────────

def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if len(a) > len(b):
        a, b = b, a
    row = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        new_row = [i]
        for j, cb in enumerate(b, 1):
            new_row.append(min(
                new_row[j - 1] + 1,
                row[j] + 1,
                row[j - 1] + (0 if ca == cb else 1),
            ))
        row = new_row
    return row[-1]


# ── Core helpers ──────────────────────────────────────────────────────────────

def extract_keyword_words(keyword: str) -> List[str]:
    """Return unique meaningful words from the keyword phrase (stop words removed)."""
    raw = re.findall(r"[a-z0-9]+", _normalize(keyword))
    seen: Set[str] = set()
    result = []
    for w in raw:
        if w not in STOP_WORDS and w not in seen:
            seen.add(w)
            result.append(w)
    # fallback: if all words were stop words, keep them all
    return result or re.findall(r"[a-z0-9]+", _normalize(keyword))


def _required_matches(n: int) -> int:
    """How many of the n keyword words must match."""
    if n <= 2:
        return n
    if n == 3:
        return 2
    if n == 4:
        return 3
    return max(3, math.ceil(n * 0.6))


def _word_found(kw_word: str,
                tokens: List[str],
                stem_set: Set[str],
                phonetic_set: Set[str]) -> bool:
    """Return True if kw_word has a fuzzy match among text tokens."""
    kw_stem    = _stem(kw_word)
    kw_phonetic = _soundex(kw_word) if len(kw_word) >= 4 else None
    max_lev    = 2 if len(kw_word) >= 8 else 1 if len(kw_word) >= 5 else 0

    # 1. Exact / substring
    for tok in tokens:
        if tok == kw_word or kw_word in tok or tok in kw_word:
            return True

    # 2. Stemmed
    if kw_stem in stem_set:
        return True

    # 3. Phonetic (Soundex)
    if kw_phonetic and kw_phonetic in phonetic_set:
        return True

    # 4. Levenshtein typo tolerance
    if max_lev > 0:
        for tok in tokens:
            if abs(len(tok) - len(kw_word)) <= max_lev:
                if _levenshtein(tok, kw_word) <= max_lev:
                    return True

    return False


# ── Public API ────────────────────────────────────────────────────────────────

def fuzzy_match(keyword: str, *texts: str) -> bool:
    """
    Return True if `keyword` fuzzy-matches any of the given text fields.

    Accepts multiple text arguments (title, body, tags, etc.) — all are
    combined into one search space.
    """
    if not keyword or not any(texts):
        return False

    kw_words = extract_keyword_words(keyword)
    if not kw_words:
        return False

    combined = _normalize(" ".join(str(t) for t in texts if t))
    tokens   = re.findall(r"[a-z0-9]+", combined)
    if not tokens:
        return False

    stem_set     = {_stem(t)    for t in tokens}
    phonetic_set = {_soundex(t) for t in tokens if len(t) >= 4}

    matched = sum(
        1 for w in kw_words
        if _word_found(w, tokens, stem_set, phonetic_set)
    )
    return matched >= _required_matches(len(kw_words))
