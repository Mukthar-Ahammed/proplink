/**
 * A minimal, dependency-free PDF writer for server-generated text documents
 * (Phase 4: the mock provider's signed copy, investor statements). A4 pages,
 * Helvetica (a standard PDF font, so nothing is embedded), plain lines with
 * optional headings. Text is limited to printable Latin-1; anything else is
 * replaced, so user data can never break the PDF syntax.
 */

export type PdfLine = { text: string; style?: "title" | "heading" | "body" | "small" };

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 56;

const STYLE: Record<NonNullable<PdfLine["style"]>, { size: number; gap: number }> = {
  title: { size: 18, gap: 28 },
  heading: { size: 12, gap: 20 },
  body: { size: 10, gap: 14 },
  small: { size: 8, gap: 11 },
};

/** Printable Latin-1 only, with PDF string escapes; £ is kept (Latin-1 0xA3). */
function pdfString(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    if (char === "\\" || char === "(" || char === ")") out += `\\${char}`;
    else if (code >= 32 && code <= 126) out += char;
    else if (code >= 160 && code <= 255) out += `\\${code.toString(8).padStart(3, "0")}`;
    else if (char === "—" || char === "–") out += "-";
    else if (char === "’" || char === "‘") out += "'";
    else out += "?";
  }
  return out;
}

/** Wraps a line to the page width (approximate Helvetica widths). */
function wrap(text: string, size: number): string[] {
  const maxChars = Math.max(20, Math.floor((PAGE_WIDTH - 2 * MARGIN) / (size * 0.5)));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  lines.push(current);
  return lines.flatMap((line) =>
    line.length <= maxChars
      ? [line]
      : (line.match(new RegExp(`.{1,${maxChars}}`, "g")) ?? [line]),
  );
}

export function renderPdf(lines: PdfLine[], meta: { title: string }): Uint8Array {
  // Lay out the lines into pages.
  const pages: string[][] = [[]];
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    const style = STYLE[line.style ?? "body"];
    const font = line.style === "title" || line.style === "heading" ? "F2" : "F1";
    for (const part of wrap(line.text, style.size)) {
      if (y - style.gap < MARGIN) {
        pages.push([]);
        y = PAGE_HEIGHT - MARGIN;
      }
      y -= style.gap;
      pages[pages.length - 1].push(
        `BT /${font} ${style.size} Tf ${MARGIN} ${y} Td (${pdfString(part)}) Tj ET`,
      );
    }
  }
  pages.forEach((page, index) => {
    page.push(
      `BT /F1 8 Tf ${MARGIN} 30 Td (${pdfString(`${meta.title} - page ${index + 1} of ${pages.length}`)}) Tj ET`,
    );
  });

  // Objects: 1 catalog, 2 pages, 3-4 fonts, 5 info, then (page, content) pairs.
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 6 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[5] = `<< /Title (${pdfString(meta.title)}) /Producer (PropLink UK) >>`;
  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const stream = page.join("\n");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] =
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });

  let body = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(body, "latin1");
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "latin1"));
}
