export async function extractMrMetadata(file: File): Promise<{ mrNumber: string | null; mrType: "CASH" | "CREDIT" | null }> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return { mrNumber: null, mrType: null };
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const signature = Array.from(bytes.slice(0, 8))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  if (!signature.includes("25504446")) {
    return { mrNumber: null, mrType: null };
  }

  const text = await extractTextFromPdf(bytes);
  if (!text || !/[A-Za-z0-9]/.test(text)) {
    return { mrNumber: null, mrType: null };
  }

  const mrNumberMatch = text.match(/M\.R\.\s*No(?:\.|\s)*[:\-\s]*([A-Za-z0-9\/\-]+)/i) ??
    text.match(/MR\s*No(?:\.|\s)*[:\-\s]*([A-Za-z0-9\/\-]+)/i);
  const mrNumber = mrNumberMatch?.[1]?.trim() ?? null;

  const containsCash = /\bcash\b/i.test(text);
  const mrType = containsCash ? "CASH" : "CREDIT";

  return { mrNumber, mrType };
}

async function extractTextFromPdf(bytes: Uint8Array): Promise<string> {
  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await getDocument({ data: bytes }).promise;

    const textChunks: string[] = [];
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      if (pageText.trim()) {
        textChunks.push(pageText.trim());
      }
    }

    return textChunks.join("\n").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}
