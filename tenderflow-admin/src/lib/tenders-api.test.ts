import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchDocumentBlobViaBackendProxy,
  pickTenderDocumentForRag,
  type TenderDocument,
} from "./tenders-api.ts";

function doc(
  name: string,
  downloadLink = `https://files.example/${encodeURIComponent(name)}`,
): TenderDocument {
  return { name, downloadLink };
}

test("pickTenderDocumentForRag prefers the real techspec over the first appendix", () => {
  const documents = [
    doc("appendix_7_17271944.pdf"),
    doc("techspec_86747976.pdf"),
    doc("ТС ЦОД 05.06.docx"),
  ];

  assert.equal(pickTenderDocumentForRag(documents)?.name, "techspec_86747976.pdf");
});

test("pickTenderDocumentForRag recognizes explicit Russian and English spec markers", () => {
  for (const name of [
    "ТС ЦОД.docx",
    "Т.З. на услуги.pdf",
    "Техническая спецификация.pdf",
    "technical_specification.docx",
    "service-specification.pdf",
  ]) {
    const documents = [doc("appendix_7.pdf"), doc(name)];
    assert.equal(pickTenderDocumentForRag(documents)?.name, name, name);
  }
});

test("pickTenderDocumentForRag keeps appendix as a fallback and supports legacy DOC downloads", () => {
  assert.equal(pickTenderDocumentForRag([doc("appendix_7.pdf")])?.name, "appendix_7.pdf");
  assert.equal(pickTenderDocumentForRag([doc("ТС услуги.doc")])?.name, "ТС услуги.doc");
  assert.equal(
    pickTenderDocumentForRag([doc("appendix_7.pdf"), doc("өтсін.pdf")])?.name,
    "appendix_7.pdf",
  );
  assert.equal(pickTenderDocumentForRag([doc("archive.rar")]), null);
});

test("fetchDocumentBlobViaBackendProxy rejects an empty successful response", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      clearTimeout,
      location: {
        hostname: "localhost",
        origin: "http://localhost:5173",
        port: "5173",
        protocol: "http:",
      },
      setTimeout,
    },
  });
  globalThis.fetch = (async () => new Response(new Uint8Array(), { status: 200 })) as typeof fetch;

  try {
    await assert.rejects(
      fetchDocumentBlobViaBackendProxy("https://files.example/empty.pdf"),
      /пустой файл/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});
