import assert from "node:assert/strict";
import test from "node:test";

import { getCurrentUser, getSession, logout, safeNextPath } from "./auth.ts";

test("SSR never caches or fetches a browser session", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("server-side auth fetch must not run");
  };
  try {
    assert.equal(getCurrentUser(), null);
    assert.equal(await getSession(), null);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("post-login destination remains same-origin", () => {
  const origin = "https://qolab.kz";
  assert.equal(safeNextPath("/tenders?page=2#lot", origin), "/tenders?page=2#lot");
  assert.equal(safeNextPath("//evil.example/path", origin), "/dashboard");
  assert.equal(safeNextPath("/\\evil.example/path", origin), "/dashboard");
  assert.equal(safeNextPath("https://evil.example/path", origin), "/dashboard");
});

test("logout does not claim success when server revocation fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("failure", { status: 500 });
  try {
    await assert.rejects(logout(), /серверную сессию/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
