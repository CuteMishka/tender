from __future__ import annotations

import math
import re
from dataclasses import dataclass
from functools import lru_cache


STOP_WORDS = {
    "и",
    "в",
    "во",
    "на",
    "по",
    "для",
    "с",
    "со",
    "к",
    "ко",
    "от",
    "до",
    "из",
    "за",
    "при",
    "или",
    "а",
    "но",
    "товар",
    "услуга",
    "работа",
    "закуп",
    "закупка",
    "приобретение",
    "согласно",
    "технический",
    "спецификация",
}


@dataclass(slots=True)
class MatchResult:
    matched: bool
    keyword: str | None
    score: float
    method: str
    reason: str


class SmartMatcher:
    def __init__(
        self,
        keywords: list[str],
        use_morphology: bool = True,
        semantic_enabled: bool = False,
        semantic_model_name: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        semantic_threshold: float = 0.7,
        min_score: float = 0.55,
    ) -> None:
        self.keywords = [keyword.strip() for keyword in keywords if keyword.strip()]
        self.use_morphology = use_morphology
        self.semantic_enabled = semantic_enabled
        self.semantic_model_name = semantic_model_name
        self.semantic_threshold = semantic_threshold
        self.min_score = min_score
        self._morph = self._load_morphology() if use_morphology else None
        self._semantic_model = None
        self._keyword_vectors: dict[str, list[float]] = {}
        self._keyword_profiles = {keyword: self._profile(keyword) for keyword in self.keywords}
        if semantic_enabled:
            self._load_semantic_model()

    def match(self, text: str, preferred_keyword: str | None = None) -> MatchResult:
        if not text.strip() or not self.keywords:
            return MatchResult(False, None, 0.0, "none", "empty text or keywords")
        ordered_keywords = self._ordered_keywords(preferred_keyword)
        text_profile = self._profile(text)
        exact = self._exact_match(text_profile["normalized"], ordered_keywords)
        if exact:
            return exact
        lemma = self._lemma_match(text_profile, ordered_keywords)
        if lemma and lemma.score >= self.min_score:
            return lemma
        semantic = self._semantic_match(text, ordered_keywords)
        if semantic and semantic.score >= self.semantic_threshold:
            return semantic
        best = lemma or semantic
        if best:
            return MatchResult(False, best.keyword, best.score, best.method, f"below threshold: {best.reason}")
        return MatchResult(False, None, 0.0, "none", "no keyword intersection")

    def _ordered_keywords(self, preferred_keyword: str | None) -> list[str]:
        if preferred_keyword and preferred_keyword in self._keyword_profiles:
            return [preferred_keyword, *[keyword for keyword in self.keywords if keyword != preferred_keyword]]
        return self.keywords

    def _exact_match(self, normalized_text: str, keywords: list[str]) -> MatchResult | None:
        for keyword in keywords:
            normalized_keyword = self._keyword_profiles[keyword]["normalized"]
            if normalized_keyword and normalized_keyword in normalized_text:
                return MatchResult(True, keyword, 1.0, "exact", "keyword phrase is present in text")
        return None

    def _lemma_match(self, text_profile: dict[str, object], keywords: list[str]) -> MatchResult | None:
        text_lemmas = text_profile["lemmas"]
        if not isinstance(text_lemmas, set):
            return None
        best: MatchResult | None = None
        for keyword in keywords:
            keyword_lemmas = self._keyword_profiles[keyword]["lemmas"]
            if not isinstance(keyword_lemmas, set) or not keyword_lemmas:
                continue
            overlap = keyword_lemmas & text_lemmas
            if not overlap:
                continue
            score = len(overlap) / len(keyword_lemmas)
            if keyword_lemmas <= text_lemmas:
                score = max(score, 0.92)
            result = MatchResult(True, keyword, score, "lemma", f"lemma overlap: {', '.join(sorted(overlap))}")
            if best is None or result.score > best.score:
                best = result
        return best

    def _semantic_match(self, text: str, keywords: list[str]) -> MatchResult | None:
        if not self.semantic_enabled or self._semantic_model is None:
            return None
        text_vector = self._embed(text[:2000])
        best: MatchResult | None = None
        for keyword in keywords:
            keyword_vector = self._keyword_vectors.get(keyword)
            if keyword_vector is None:
                keyword_vector = self._embed(keyword)
                self._keyword_vectors[keyword] = keyword_vector
            score = self._cosine(text_vector, keyword_vector)
            result = MatchResult(score >= self.semantic_threshold, keyword, score, "semantic", "semantic embedding similarity")
            if best is None or result.score > best.score:
                best = result
        return best

    def _profile(self, text: str) -> dict[str, object]:
        normalized = self._normalize(text)
        tokens = self._tokens(normalized)
        lemmas = {self._lemma(token) for token in tokens if token not in STOP_WORDS and len(token) > 1}
        return {"normalized": normalized, "tokens": tokens, "lemmas": lemmas}

    def _normalize(self, text: str) -> str:
        return re.sub(r"\s+", " ", text.lower().replace("ё", "е")).strip()

    def _tokens(self, text: str) -> list[str]:
        return re.findall(r"[a-zа-я0-9]+", text.lower().replace("ё", "е"), flags=re.IGNORECASE)

    @lru_cache(maxsize=20000)
    def _lemma(self, token: str) -> str:
        if self._morph is None:
            return token
        parsed = self._morph.parse(token)
        return parsed[0].normal_form.replace("ё", "е") if parsed else token

    def _load_morphology(self):
        try:
            import pymorphy3

            return pymorphy3.MorphAnalyzer()
        except Exception:
            return None

    def _load_semantic_model(self) -> None:
        try:
            from sentence_transformers import SentenceTransformer

            self._semantic_model = SentenceTransformer(self.semantic_model_name)
        except Exception:
            self._semantic_model = None
            self.semantic_enabled = False

    def _embed(self, text: str) -> list[float]:
        if self._semantic_model is None:
            return []
        vector = self._semantic_model.encode(text, normalize_embeddings=True)
        return [float(value) for value in vector]

    def _cosine(self, left: list[float], right: list[float]) -> float:
        if not left or not right or len(left) != len(right):
            return 0.0
        numerator = sum(a * b for a, b in zip(left, right, strict=False))
        left_norm = math.sqrt(sum(a * a for a in left))
        right_norm = math.sqrt(sum(b * b for b in right))
        if left_norm == 0 or right_norm == 0:
            return 0.0
        return numerator / (left_norm * right_norm)
