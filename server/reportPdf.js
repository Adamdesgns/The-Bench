// reportPdf.js - dependency-free, deterministic PDF rendering for saved reports.
//
// The Electron package already includes Node, so this deliberately avoids a
// runtime dependency or an external process. It writes a small, standards-based
// PDF using the built-in Helvetica fonts and keeps every report portable.

const PAGE = { width: 612, height: 792, margin: 48 };
const COLORS = {
  ink: [0.075, 0.11, 0.16],
  muted: [0.33, 0.38, 0.44],
  navy: [0.035, 0.075, 0.13],
  gold: [0.82, 0.62, 0.19],
  line: [0.82, 0.84, 0.86],
  paper: [0.97, 0.975, 0.98],
  white: [1, 1, 1],
  red: [0.67, 0.16, 0.16],
};

function ascii(value) {
  return String(value ?? "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u25cf]/g, "-")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function pdfText(value) {
  return ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function color(values, stroke = false) {
  return `${values.join(" ")} ${stroke ? "RG" : "rg"}`;
}

function rect(x, y, width, height, fill) {
  return `${color(fill)}\n${x} ${y} ${width} ${height} re f`;
}

function line(x1, y1, x2, y2, stroke, width = 1) {
  return `${color(stroke, true)}\n${width} w\n${x1} ${y1} m ${x2} ${y2} l S`;
}

function text(value, x, y, { font = "F1", size = 10, fill = COLORS.ink } = {}) {
  return `${color(fill)}\nBT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfText(value)}) Tj ET`;
}

function wrap(value, maxChars) {
  const clean = ascii(value);
  if (!clean) return [];
  const words = clean.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) lines.push(current);
      for (let at = 0; at < word.length; at += maxChars) lines.push(word.slice(at, at + maxChars));
      current = "";
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function moneyOrValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return ascii(value || "not observable");
}

function titleFor(report) {
  if (report.title) return ascii(report.title);
  return report.target === "market" ? "Daily Market Report" : `$${ascii(report.target).toUpperCase()} Research Report`;
}

function reportSections(report) {
  if (Array.isArray(report.sections) && report.sections.length) {
    return report.sections.map((section) => ({
      title: ascii(section?.title || "Analysis"),
      body: ascii(section?.body || section?.text || ""),
    })).filter((section) => section.body);
  }

  const raw = String(report.report_text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [{ title: "Analysis", body: "No narrative was returned for this report." }];
  const blocks = raw.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const sections = [];
  let current = { title: "Research Brief", body: "" };
  for (const block of blocks) {
    const lines = block.split("\n").map((part) => part.trim()).filter(Boolean);
    const first = ascii(lines[0]);
    const heading = lines.length === 1 && first.length <= 72 && first === first.toUpperCase();
    if (heading) {
      if (current.body) sections.push(current);
      current = { title: first, body: "" };
    } else {
      current.body += `${current.body ? "\n" : ""}${lines.map(ascii).join("\n")}`;
    }
  }
  if (current.body) sections.push(current);
  return sections.length ? sections : [{ title: "Research Brief", body: ascii(raw) }];
}

function buildPages(report) {
  const pages = [];
  let commands = [];
  let y = PAGE.height - 152;
  let pageNumber = 0;

  function pageHeader(first = false) {
    pageNumber += 1;
    commands.push(rect(0, 0, PAGE.width, PAGE.height, COLORS.white));
    commands.push(rect(0, PAGE.height - (first ? 126 : 66), PAGE.width, first ? 126 : 66, COLORS.navy));
    commands.push(rect(PAGE.margin, PAGE.height - (first ? 126 : 66), 54, 4, COLORS.gold));
    commands.push(text("THE BENCH", PAGE.margin, PAGE.height - 35, { font: "F2", size: 10, fill: COLORS.gold }));
    if (first) {
      commands.push(text(titleFor(report), PAGE.margin, PAGE.height - 66, { font: "F2", size: 24, fill: COLORS.white }));
      commands.push(text("INSTITUTIONAL RESEARCH BRIEF", PAGE.margin, PAGE.height - 89, { font: "F1", size: 9, fill: COLORS.white }));
      const meta = `${ascii(report.target || "market").toUpperCase()}  |  ${ascii(report.as_of || report.stamp || report.created_at || "as of unavailable")}  |  ${ascii(report.status || (report.ok === false ? "attention" : "complete")).toUpperCase()}`;
      commands.push(text(meta, PAGE.margin, PAGE.height - 108, { font: "F3", size: 7.5, fill: [0.79, 0.83, 0.87] }));
      y = PAGE.height - 154;
    } else {
      commands.push(text(titleFor(report), PAGE.margin, PAGE.height - 51, { font: "F1", size: 9, fill: COLORS.white }));
      y = PAGE.height - 92;
    }
  }

  function finishPage() {
    const footerY = 26;
    commands.push(line(PAGE.margin, footerY + 12, PAGE.width - PAGE.margin, footerY + 12, COLORS.line, 0.6));
    commands.push(text("Research only - not investment advice. No order routing.", PAGE.margin, footerY, { size: 7, fill: COLORS.muted }));
    commands.push(text(`PAGE ${pageNumber}`, PAGE.width - PAGE.margin - 38, footerY, { font: "F3", size: 7, fill: COLORS.muted }));
    pages.push(commands.join("\n"));
    commands = [];
  }

  function need(height) {
    if (y - height >= 54) return;
    finishPage();
    pageHeader(false);
  }

  function heading(value, { danger = false } = {}) {
    need(38);
    commands.push(text(ascii(value).toUpperCase(), PAGE.margin, y, { font: "F2", size: 11, fill: danger ? COLORS.red : COLORS.ink }));
    y -= 8;
    commands.push(line(PAGE.margin, y, PAGE.width - PAGE.margin, y, danger ? COLORS.red : COLORS.gold, 1.25));
    y -= 20;
  }

  function paragraph(value, options = {}) {
    const size = options.size || 9.5;
    const leading = options.leading || 14;
    const maxChars = options.maxChars || 92;
    const parts = String(value || "").split("\n");
    for (const part of parts) {
      const lines = wrap(part, maxChars);
      if (!lines.length) { y -= leading / 2; continue; }
      for (const wrapped of lines) {
        need(leading + 2);
        commands.push(text(wrapped, PAGE.margin, y, { font: options.font || "F1", size, fill: options.fill || COLORS.ink }));
        y -= leading;
      }
      y -= 3;
    }
  }

  pageHeader(true);

  if (report.summary) {
    heading("Executive read");
    paragraph(report.summary, { size: 11, leading: 16, maxChars: 80 });
    y -= 4;
  }

  if (Array.isArray(report.errors) && report.errors.length) {
    heading("Data and model limitations", { danger: true });
    for (const error of report.errors) paragraph(`- ${error}`, { size: 8.5, leading: 12, maxChars: 100, fill: COLORS.red });
  }

  const board = Array.isArray(report.board) ? report.board : [];
  if (board.length) {
    heading("Observed board");
    const columns = [PAGE.margin, 96, 162, 238, 336];
    const labels = ["ID", "TICKER", "LAST", "SOURCE", "STATE"];
    need(28);
    commands.push(rect(PAGE.margin, y - 5, PAGE.width - PAGE.margin * 2, 20, COLORS.paper));
    labels.forEach((label, index) => commands.push(text(label, columns[index], y + 1, { font: "F2", size: 7, fill: COLORS.muted })));
    y -= 19;
    for (const row of board) {
      need(23);
      const values = [row.id || "-", row.ticker || "-", moneyOrValue(row.last), `${row.source || "unknown"}${row.provisional ? " / delayed" : ""}`, row.state || row.action || "-"];
      values.forEach((value, index) => {
        const width = index === 4 ? 47 : [7, 9, 14, 20][index];
        const shown = ascii(value).slice(0, width);
        commands.push(text(shown, columns[index], y, { font: index === 1 ? "F2" : "F3", size: 7.5, fill: COLORS.ink }));
      });
      y -= 15;
      commands.push(line(PAGE.margin, y + 5, PAGE.width - PAGE.margin, y + 5, COLORS.line, 0.35));
    }
    y -= 10;
  }

  for (const section of reportSections(report)) {
    heading(section.title);
    paragraph(section.body);
    y -= 5;
  }

  if (Array.isArray(report.sources) && report.sources.length) {
    heading("Sources and timestamps");
    report.sources.forEach((source, index) => {
      const label = typeof source === "string"
        ? source
        : `${source?.label || source?.title || source?.name || (source?.ticker ? `$${source.ticker}` : `Source ${index + 1}`)}${source?.quote ? ` - quote: ${source.quote}` : ""}${source?.history ? ` - history: ${source.history}` : ""}${source?.provisional ? " - delayed/provisional" : ""}${source?.asof || source?.as_of ? ` - as-of: ${source.asof || source.as_of}` : ""}${source?.url ? ` - ${source.url}` : ""}`;
      paragraph(`${index + 1}. ${label}`, { size: 8, leading: 11, maxChars: 108, fill: COLORS.muted });
    });
  }

  finishPage();
  return pages;
}

function pdfObject(value) {
  return Buffer.from(value, "latin1");
}

export function renderReportPdf(report) {
  if (!report || typeof report !== "object") throw new TypeError("report must be an object");
  const pageStreams = buildPages(report);
  const objects = new Map();
  const pageIds = pageStreams.map((_, index) => 6 + index * 2);
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.set(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  objects.set(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");

  pageStreams.forEach((stream, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const streamBytes = Buffer.byteLength(stream, "latin1");
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.set(contentId, `<< /Length ${streamBytes} >>\nstream\n${stream}\nendstream`);
  });

  const maxId = Math.max(...objects.keys());
  const chunks = [pdfObject("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")];
  const offsets = [0];
  let offset = chunks[0].length;
  for (let id = 1; id <= maxId; id += 1) {
    offsets[id] = offset;
    const chunk = pdfObject(`${id} 0 obj\n${objects.get(id)}\nendobj\n`);
    chunks.push(chunk);
    offset += chunk.length;
  }
  const xrefOffset = offset;
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(pdfObject(xref));
  return Buffer.concat(chunks);
}

export const __pdfInternals = { ascii, wrap, reportSections, buildPages };
