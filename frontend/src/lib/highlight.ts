/**
 * 키워드 하이라이팅 유틸리티
 * XSS 방지 처리 포함
 */

/**
 * HTML 특수문자 이스케이프 (XSS 방지)
 */
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char]);
}

/**
 * 정규식 특수문자 이스케이프
 */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 검색어 키워드를 하이라이팅한 HTML 문자열 반환
 *
 * @param text - 원본 텍스트
 * @param query - 검색어 (공백으로 구분된 여러 키워드)
 * @param className - 하이라이트에 적용할 CSS 클래스
 * @returns 하이라이팅된 HTML 문자열
 */
export function highlightKeywords(
  text: string,
  query: string,
  className: string = "bg-yellow-200 rounded px-0.5"
): string {
  if (!text || !query.trim()) {
    return escapeHtml(text || "");
  }

  // 1. 원본 텍스트 HTML 이스케이프 (XSS 방지)
  const escapedText = escapeHtml(text);

  // 2. 검색어에서 따옴표 제거 후 공백으로 분리하고 2글자 이상만 필터링
  const cleanQuery = query.replace(/^"|"$/g, ""); // 앞뒤 따옴표 제거
  const keywords = cleanQuery
    .trim()
    .split(/\s+/)
    .filter((keyword) => keyword.length >= 2)
    .map((keyword) => escapeRegex(escapeHtml(keyword)));

  if (keywords.length === 0) {
    return escapedText;
  }

  // 3. 키워드들을 OR로 묶은 정규식 생성 (대소문자 무시)
  const pattern = new RegExp(`(${keywords.join("|")})`, "gi");

  // 4. 매칭된 부분을 <mark> 태그로 감싸기
  return escapedText.replace(pattern, `<mark class="${className}">$1</mark>`);
}

/**
 * React 컴포넌트에서 사용하기 위한 하이라이팅 props 반환
 * dangerouslySetInnerHTML과 함께 사용
 *
 * @example
 * <span {...createHighlightProps(text, query)} />
 */
export function createHighlightProps(
  text: string,
  query: string,
  className?: string
): { dangerouslySetInnerHTML: { __html: string } } {
  return {
    dangerouslySetInnerHTML: {
      __html: highlightKeywords(text, query, className),
    },
  };
}
