import { describe, expect, it } from "vitest";
import { MAX_PDF_BYTES, PdfReadError, readPdf, toHex } from "@/lib/pdf/read-pdf";

describe("read-pdf pure helpers", () => {
  it("converts bytes to lowercase hex", () => {
    expect(toHex(new Uint8Array([0, 15, 16, 255]).buffer)).toBe("000f10ff");
  });

  it("rejects files over 15 MB as too_large", async () => {
    const file = new File([new Uint8Array(MAX_PDF_BYTES + 1)], "big.pdf", { type: "application/pdf" });
    const error = await readPdf(file).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfReadError);
    expect((error as PdfReadError).code).toBe("too_large");
  });

  it("rejects files without a PDF header as invalid", async () => {
    const file = new File(["not a pdf at all"], "fake.pdf", { type: "application/pdf" });
    const error = await readPdf(file).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfReadError);
    expect((error as PdfReadError).code).toBe("invalid");
  });
});
