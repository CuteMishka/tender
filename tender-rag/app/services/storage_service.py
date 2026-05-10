from __future__ import annotations

import os
from pathlib import Path

import aioboto3


class ObjectStorageService:
    def __init__(self) -> None:
        self.backend = os.environ.get("STORAGE_BACKEND", "local").lower()
        self.bucket = os.environ.get("S3_BUCKET", "tender-machine")
        self.local_root = Path(os.environ.get("LOCAL_STORAGE_DIR", "files/generated")).resolve()
        self.endpoint_url = os.environ.get("S3_ENDPOINT_URL") or None
        self.region_name = os.environ.get("S3_REGION", "us-east-1")
        self.public_base_url = (os.environ.get("S3_PUBLIC_BASE_URL") or "").rstrip("/")

    async def put_bytes(self, key: str, data: bytes, content_type: str) -> dict[str, str | None]:
        if self.backend in {"s3", "minio"}:
            return await self._put_s3(key, data, content_type)
        return await self._put_local(key, data)

    async def _put_s3(self, key: str, data: bytes, content_type: str) -> dict[str, str | None]:
        session = aioboto3.Session()
        async with session.client("s3", endpoint_url=self.endpoint_url, region_name=self.region_name) as client:
            await client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)
        url = f"{self.public_base_url}/{self.bucket}/{key}" if self.public_base_url else None
        return {"backend": self.backend, "bucket": self.bucket, "key": key, "url": url}

    async def _put_local(self, key: str, data: bytes) -> dict[str, str | None]:
        path = self.local_root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return {"backend": "local", "bucket": None, "key": key, "url": str(path)}
