import type { Editor } from "@tiptap/react";

export type ExportFormat = "pdf" | "docx" | "hwpx";

/**
 * tiptap-editor.css 스타일을 PDF 내보내기용으로 변환한 문자열.
 * CSS 변수(hsl(var(--border)) 등)는 해상된 실제 값으로 치환.
 */
const EDITOR_CSS_FOR_EXPORT = `
.ProseMirror {
  outline: none;
  min-height: 100%;
  padding: 1rem;
  font-size: 10pt;
  color: #000;
  line-height: 1.7;
}
.ProseMirror h1 {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 1.5rem 0 0.75rem;
  text-align: center;
}
.ProseMirror h2 {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 1.25rem 0 0.5rem;
}
.ProseMirror h3 {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 1rem 0 0.5rem;
}
.ProseMirror p {
  margin-bottom: 0.5rem;
  line-height: 1.7;
}
.ProseMirror ul {
  list-style: disc;
  padding-left: 1.5rem;
  margin-bottom: 0.5rem;
}
.ProseMirror ol {
  list-style: decimal;
  padding-left: 1.5rem;
  margin-bottom: 0.5rem;
}
.ProseMirror li {
  margin-bottom: 0.25rem;
}
.ProseMirror strong {
  font-weight: 700;
}
.ProseMirror em {
  font-style: italic;
}
.ProseMirror u {
  text-decoration: underline;
}
.ProseMirror hr {
  border: none;
  border-top: 1px solid #E8ECF4;
  margin: 1rem 0;
}
.ProseMirror blockquote {
  border-left: 3px solid #E8ECF4;
  padding-left: 1rem;
  margin-left: 0;
  color: #64748B;
  font-size: 0.85rem;
}
.ProseMirror .has-text-align-center { text-align: center; }
.ProseMirror .has-text-align-right { text-align: right; }
.ProseMirror .has-text-align-left { text-align: left; }
.ProseMirror table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.75rem 0;
  table-layout: fixed;
}
.ProseMirror th,
.ProseMirror td {
  border: 1px solid #333;
  padding: 7px 10px;
  font-size: 0.85rem;
  vertical-align: middle;
  line-height: 1.5;
  word-break: keep-all;
  overflow-wrap: break-word;
}
.ProseMirror th {
  background: #f5f5f5;
  font-weight: 500;
  text-align: center;
}
.ProseMirror td {
  min-height: 32px;
}
.ProseMirror th p,
.ProseMirror td p {
  margin-bottom: 0;
}
.ProseMirror span[data-ai-filled="true"] {
  color: #000 !important;
}
`;

/**
 * 에디터 DOM을 클론하고 내보내기용으로 정리
 */
function cloneEditorDom(editor: Editor): HTMLElement {
  const editorDom = editor.view.dom as HTMLElement;
  const clone = editorDom.cloneNode(true) as HTMLElement;

  // contenteditable 제거
  clone.removeAttribute("contenteditable");
  clone.removeAttribute("role");
  clone.removeAttribute("aria-multiline");
  clone.removeAttribute("tabindex");
  clone.querySelectorAll("[contenteditable]").forEach((el) => {
    el.removeAttribute("contenteditable");
  });

  // 에디터 전용 UI 요소 제거
  clone.querySelectorAll(".ProseMirror-selectednode, .ProseMirror-gapcursor, .ProseMirror-trailingBreak").forEach((el) => {
    el.classList.remove("ProseMirror-selectednode");
  });

  // data-ai-filled 색상을 검정으로 강제
  clone.querySelectorAll("[data-ai-filled]").forEach((el) => {
    (el as HTMLElement).style.color = "#000";
  });

  return clone;
}

/**
 * HTML → PDF 내보내기 (html2pdf.js)
 * editor가 있으면 DOM 클론 방식, 없으면 content fallback
 */
export async function exportToPdf(title: string, content: string, editor?: Editor | null): Promise<void> {
  const html2pdf = (await import("html2pdf.js")).default;

  const style = document.createElement("style");
  style.textContent = EDITOR_CSS_FOR_EXPORT;
  document.head.appendChild(style);

  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = "210mm";
  container.style.padding = "15mm 20mm";
  container.style.background = "#fff";

  if (editor) {
    const clone = cloneEditorDom(editor);
    container.appendChild(clone);
  } else {
    // fallback: content HTML을 ProseMirror 클래스 안에 삽입
    const wrapper = document.createElement("div");
    wrapper.className = "ProseMirror";
    wrapper.innerHTML = content;
    container.appendChild(wrapper);
  }

  document.body.appendChild(container);

  // 폰트 로딩 대기
  await document.fonts.ready;

  try {
    await html2pdf()
      .set({
        margin: [15, 20, 15, 20],
        filename: `${title || "document"}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(container)
      .save();
  } finally {
    document.body.removeChild(container);
    document.head.removeChild(style);
  }
}

/**
 * html-to-docx 전용 HTML 문서 생성 (tiptap-editor.css와 동기화된 CSS)
 */
function buildDocxHtml(title: string, content: string, editor?: Editor | null): string {
  // editor가 있으면 실제 DOM의 innerHTML 사용 (서식 클래스 보존)
  let htmlBody = content;
  if (editor) {
    const clone = cloneEditorDom(editor);
    htmlBody = clone.innerHTML;
  }

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>${title || "문서"}</title>
<style>
body{font-family:'Malgun Gothic',sans-serif;font-size:10pt;color:#000;line-height:1.7}
h1{font-size:1.5rem;font-weight:700;text-align:center;margin:1.5rem 0 0.75rem}
h2{font-size:1.25rem;font-weight:600;margin:1.25rem 0 0.5rem}
h3{font-size:1.1rem;font-weight:600;margin:1rem 0 0.5rem}
p{margin-bottom:0.5rem;line-height:1.7}
table{width:100%;border-collapse:collapse;table-layout:fixed;margin:0.75rem 0}
th,td{border:1px solid #333;padding:7px 10px;font-size:0.85rem;vertical-align:middle;line-height:1.5}
th{background:#f5f5f5;font-weight:500;text-align:center}
blockquote{border-left:3px solid #E8ECF4;padding-left:1rem;color:#64748B;font-size:0.85rem}
hr{border:none;border-top:1px solid #E8ECF4;margin:1rem 0}
ul{list-style:disc;padding-left:1.5rem;margin-bottom:0.5rem}
ol{list-style:decimal;padding-left:1.5rem;margin-bottom:0.5rem}
li{margin-bottom:0.25rem}
u{text-decoration:underline}
.has-text-align-center{text-align:center}
.has-text-align-right{text-align:right}
.has-text-align-left{text-align:left}
[data-ai-filled]{color:#000 !important;background:none !important}
</style></head><body>${htmlBody}</body></html>`;
}

/**
 * HTML → DOCX 내보내기 (html-to-docx)
 */
export async function exportToDocx(title: string, content: string, editor?: Editor | null): Promise<void> {
  const HTMLtoDOCX = (await import("html-to-docx")).default;

  const htmlDoc = buildDocxHtml(title, content, editor);

  const result = await HTMLtoDOCX(htmlDoc, undefined, {
    table: { row: { cantSplit: true } },
    font: "Malgun Gothic",
    fontSize: 20, // half-points: 20 = 10pt
  });

  // html-to-docx가 Buffer(polyfill)를 반환할 수 있으므로 Blob으로 확실히 변환
  const blob = result instanceof Blob
    ? result
    : new Blob([result], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

  triggerDownload(blob, `${title || "document"}.docx`);
}

/**
 * HTML → HWPX 내보내기 (OWPML ZIP 아카이브)
 */
export async function exportToHwpx(title: string, content: string): Promise<void> {
  const JSZip = (await import("jszip")).default;

  const zip = new JSZip();

  // mimetype (비압축 - HWPX 스펙 필수)
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });

  // version.xml
  zip.file(
    "version.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<opf:version xmlns:opf="http://www.idpf.org/2007/opf" major="1" minor="2" micro="0"/>`
  );

  // META-INF
  const metaInf = zip.folder("META-INF")!;
  metaInf.file(
    "container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>
  </rootfiles>
</container>`
  );
  metaInf.file(
    "manifest.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
  <file-entry full-path="/" media-type="application/hwp+zip"/>
  <file-entry full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>
  <file-entry full-path="Contents/header.xml" media-type="application/hwpml-head+xml"/>
  <file-entry full-path="Contents/section0.xml" media-type="application/hwpml-section+xml"/>
</manifest>`
  );

  // Contents
  const contents = zip.folder("Contents")!;

  // content.hpf
  contents.file(
    "content.hpf",
    `<?xml version="1.0" encoding="UTF-8"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf" version="1.2">
  <opf:metadata/>
  <opf:manifest>
    <opf:item id="header" href="header.xml" media-type="application/hwpml-head+xml"/>
    <opf:item id="section0" href="section0.xml" media-type="application/hwpml-section+xml"/>
  </opf:manifest>
  <opf:spine>
    <opf:itemref idref="section0"/>
  </opf:spine>
</opf:package>`
  );

  // header.xml - A4 설정 (59528 x 84188 hwp unit) + underline charPr id="5" 추가
  contents.file(
    "header.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hp:head xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
         xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
  <hc:beginNum page="1" footnote="1" endnote="1"/>
  <hc:refList>
    <hc:fontfaces>
      <hc:fontface lang="HANGUL">
        <hc:font id="0" face="함초롬바탕" type="TTF"/>
      </hc:fontface>
      <hc:fontface lang="LATIN">
        <hc:font id="0" face="함초롬바탕" type="TTF"/>
      </hc:fontface>
    </hc:fontfaces>
    <hc:charProperties>
      <hc:charPr id="0">
        <hc:fontRef hangul="0" latin="0"/>
        <hc:ratio hangul="100" latin="100"/>
        <hc:sz val="1000" unit="hwpunit"/>
      </hc:charPr>
      <hc:charPr id="1">
        <hc:fontRef hangul="0" latin="0"/>
        <hc:ratio hangul="100" latin="100"/>
        <hc:sz val="2200" unit="hwpunit"/>
        <hc:bold/>
      </hc:charPr>
      <hc:charPr id="2">
        <hc:fontRef hangul="0" latin="0"/>
        <hc:ratio hangul="100" latin="100"/>
        <hc:sz val="1050" unit="hwpunit"/>
        <hc:bold/>
      </hc:charPr>
      <hc:charPr id="3">
        <hc:fontRef hangul="0" latin="0"/>
        <hc:ratio hangul="100" latin="100"/>
        <hc:sz val="1000" unit="hwpunit"/>
        <hc:bold/>
      </hc:charPr>
      <hc:charPr id="4">
        <hc:fontRef hangul="0" latin="0"/>
        <hc:ratio hangul="100" latin="100"/>
        <hc:sz val="1000" unit="hwpunit"/>
        <hc:italic/>
      </hc:charPr>
      <hc:charPr id="5">
        <hc:fontRef hangul="0" latin="0"/>
        <hc:ratio hangul="100" latin="100"/>
        <hc:sz val="1000" unit="hwpunit"/>
        <hc:underline/>
      </hc:charPr>
    </hc:charProperties>
    <hc:paraProperties>
      <hc:paraPr id="0">
        <hc:align horizontal="JUSTIFY"/>
        <hc:heading type="NONE" level="0"/>
      </hc:paraPr>
      <hc:paraPr id="1">
        <hc:align horizontal="CENTER"/>
        <hc:heading type="NONE" level="0"/>
      </hc:paraPr>
      <hc:paraPr id="2">
        <hc:align horizontal="JUSTIFY"/>
        <hc:margin indent="800"/>
        <hc:heading type="NONE" level="0"/>
      </hc:paraPr>
      <hc:paraPr id="3">
        <hc:align horizontal="RIGHT"/>
        <hc:heading type="NONE" level="0"/>
      </hc:paraPr>
    </hc:paraProperties>
  </hc:refList>
  <hc:secProperties>
    <hc:secPr>
      <hc:sz width="59528" height="84188"/>
      <hc:margin left="4252" right="4252" top="5668" bottom="4252" header="4252" footer="4252"/>
    </hc:secPr>
  </hc:secProperties>
</hp:head>`
  );

  // section0.xml - HTML을 OWPML로 변환
  const sectionXml = convertHtmlToOwpml(content);
  contents.file("section0.xml", sectionXml);

  // ZIP 생성 및 다운로드
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/hwp+zip" });
  triggerDownload(blob, `${title || "document"}.hwpx`);
}

/**
 * 요소의 text-align 관련 클래스 또는 style로부터 paraPrId를 결정
 */
function getAlignParaPrId(el: Element, defaultId: string): string {
  const style = el.getAttribute("style") || "";
  const classList = el.className || "";

  if (classList.includes("has-text-align-center") || /text-align:\s*center/i.test(style)) {
    return "1"; // CENTER
  }
  if (classList.includes("has-text-align-right") || /text-align:\s*right/i.test(style)) {
    return "3"; // RIGHT
  }
  return defaultId;
}

/**
 * HTML 콘텐츠를 OWPML section XML로 변환
 */
function convertHtmlToOwpml(htmlContent: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${htmlContent}</div>`, "text/html");
  const body = doc.body.firstElementChild || doc.body;

  const paragraphs: string[] = [];

  function processNodes(parent: Element) {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        if (text) {
          paragraphs.push(makeParagraph(escapeXml(text), "0", "0"));
        }
        continue;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;
      const tag = el.tagName.toLowerCase();

      switch (tag) {
        case "h1":
          paragraphs.push(makeParagraph(escapeXml(el.textContent || ""), getAlignParaPrId(el, "1"), "1"));
          break;
        case "h2":
          paragraphs.push(makeParagraph(escapeXml(el.textContent || ""), getAlignParaPrId(el, "0"), "2"));
          break;
        case "h3":
          paragraphs.push(makeParagraph(escapeXml(el.textContent || ""), getAlignParaPrId(el, "0"), "3"));
          break;
        case "p":
          paragraphs.push(makeParagraphFromInline(el, getAlignParaPrId(el, "0"), "0"));
          break;
        case "blockquote":
          paragraphs.push(makeParagraphFromInline(el, "2", "4"));
          break;
        case "ul":
        case "ol":
          processListItems(el);
          break;
        case "table":
          paragraphs.push(convertTable(el));
          break;
        case "hr":
          paragraphs.push(makeParagraph("", "0", "0"));
          break;
        default:
          processNodes(el);
          break;
      }
    }
  }

  function processListItems(listEl: Element) {
    for (const li of Array.from(listEl.querySelectorAll("li"))) {
      const bullet = listEl.tagName.toLowerCase() === "ol" ? "" : "- ";
      paragraphs.push(makeParagraph(escapeXml(bullet + (li.textContent || "")), "2", "0"));
    }
  }

  processNodes(body);

  return `<?xml version="1.0" encoding="UTF-8"?>
<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
        xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
${paragraphs.join("\n")}
</hp:sec>`;
}

function makeParagraph(text: string, paraPrId: string, charPrId: string): string {
  return `  <hp:p paraPrIDRef="${paraPrId}">
    <hp:run charPrIDRef="${charPrId}">
      <hp:t>${text}</hp:t>
    </hp:run>
  </hp:p>`;
}

function makeParagraphFromInline(el: Element, paraPrId: string, defaultCharPrId: string): string {
  const runs: string[] = [];

  function walkInline(node: Node, charPrId: string) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      if (text) {
        runs.push(`    <hp:run charPrIDRef="${charPrId}"><hp:t>${escapeXml(text)}</hp:t></hp:run>`);
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = (node as Element).tagName.toLowerCase();
    let childCharPr = charPrId;
    if (tag === "strong" || tag === "b") childCharPr = "3";
    else if (tag === "em" || tag === "i") childCharPr = "4";
    else if (tag === "u") childCharPr = "5";

    for (const child of Array.from(node.childNodes)) {
      walkInline(child, childCharPr);
    }
  }

  for (const child of Array.from(el.childNodes)) {
    walkInline(child, defaultCharPrId);
  }

  if (runs.length === 0) {
    runs.push(`    <hp:run charPrIDRef="${defaultCharPrId}"><hp:t></hp:t></hp:run>`);
  }

  return `  <hp:p paraPrIDRef="${paraPrId}">
${runs.join("\n")}
  </hp:p>`;
}

function convertTable(tableEl: Element): string {
  const rows = Array.from(tableEl.querySelectorAll("tr"));
  if (rows.length === 0) return "";

  const maxCols = rows.reduce((max, row) => {
    const cells = Array.from(row.querySelectorAll("th, td"));
    const colCount = cells.reduce((sum, cell) => sum + (parseInt(cell.getAttribute("colspan") || "1")), 0);
    return Math.max(max, colCount);
  }, 0);

  // 컬럼 너비 균등 분배 (A4 본문 폭 = 59528 - 4252*2 = 51024)
  const colWidth = Math.floor(51024 / maxCols);

  const rowsXml = rows.map((row) => {
    const cells = Array.from(row.querySelectorAll("th, td"));
    const cellsXml = cells.map((cell) => {
      const colspan = parseInt(cell.getAttribute("colspan") || "1");
      const text = escapeXml(cell.textContent || "");
      const charPrId = cell.tagName.toLowerCase() === "th" ? "3" : "0";
      return `        <hp:tc colspan="${colspan}">
          <hp:cellSz width="${colWidth * colspan}" height="0"/>
          <hp:cellAddr colAddr="0" rowAddr="0"/>
          <hp:p paraPrIDRef="0">
            <hp:run charPrIDRef="${charPrId}"><hp:t>${text}</hp:t></hp:run>
          </hp:p>
        </hp:tc>`;
    }).join("\n");

    return `      <hp:tr>
${cellsXml}
      </hp:tr>`;
  }).join("\n");

  return `  <hp:tbl>
    <hp:tblPr>
      <hp:sz width="51024" widthRelTo="ABSOLUTE"/>
    </hp:tblPr>
${rowsXml}
  </hp:tbl>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 브라우저가 blob을 읽을 시간을 확보한 후 해제
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
