from __future__ import annotations

import hashlib
import logging
import re
import threading
from typing import Sequence

import numpy as np
from sentence_transformers import SentenceTransformer

from app.config import EMBEDDING_DIM, EMBEDDING_MODEL

logger = logging.getLogger(__name__)
_lock = threading.Lock()
_model: SentenceTransformer | None = None
_model_disabled = False


def get_model() -> SentenceTransformer | None:
    global _model, _model_disabled
    with _lock:
        if EMBEDDING_MODEL.strip().lower() in {"hash", "hashing", "offline", "fallback"}:
            _model_disabled = True
            return None
        if _model_disabled:
            return None
        if _model is None:
            try:
                _model = SentenceTransformer(EMBEDDING_MODEL)
            except Exception:
                _model_disabled = True
                logger.exception("embedding model unavailable, using hashing fallback")
                return None
        return _model


def _disable_model() -> None:
    global _model, _model_disabled
    with _lock:
        _model = None
        _model_disabled = True


def _hash_embeddings(texts: Sequence[str]) -> np.ndarray:
    rows: list[np.ndarray] = []
    for text in texts:
        vector = np.zeros(EMBEDDING_DIM, dtype=np.float32)
        tokens = re.findall(r"[\wа-яА-ЯёЁ]+", text.lower())
        if not tokens:
            tokens = [text.lower() or "empty"]
        for token in tokens:
            digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
            idx = int.from_bytes(digest[:4], "little") % EMBEDDING_DIM
            sign = 1.0 if digest[4] & 1 else -1.0
            weight = 1.0 + min(len(token), 24) / 24.0
            vector[idx] += sign * weight
        norm = float(np.linalg.norm(vector))
        if norm > 0:
            vector /= norm
        rows.append(vector)
    return np.vstack(rows)


def embed_queries(texts: Sequence[str]) -> np.ndarray:
    m = get_model()
    prefixed = [f"query: {t}" if not t.strip().lower().startswith("query:") else t for t in texts]
    if m is None:
        return _hash_embeddings(prefixed)
    try:
        return m.encode(
            list(prefixed),
            normalize_embeddings=True,
            show_progress_bar=False,
        )
    except Exception:
        logger.exception("embedding model encode failed, using hashing fallback")
        _disable_model()
        return _hash_embeddings(prefixed)


def embed_passages(texts: Sequence[str]) -> np.ndarray:
    m = get_model()
    out: list[str] = []
    for t in texts:
        t = t.strip()
        if t.lower().startswith("passage:"):
            out.append(t)
        else:
            out.append(f"passage: {t}")
    if m is None:
        return _hash_embeddings(out)
    try:
        return m.encode(
            out,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
    except Exception:
        logger.exception("embedding model encode failed, using hashing fallback")
        _disable_model()
        return _hash_embeddings(out)


def embed_profile(profile: str) -> list[float]:
    v = embed_queries([profile])[0]
    return np.asarray(v, dtype=np.float32).tolist()


def embed_chunks(chunks: Sequence[str]) -> list[list[float]]:
    mat = embed_passages(chunks)
    return [np.asarray(row, dtype=np.float32).tolist() for row in mat]
