import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface LawRefClickData {
  /** 직접 조문 참조 (형법 제319조 등) */
  lawName?: string;
  articleNumber?: string;
  paragraph?: string;
  /** 법률 용어 검색 (주거침입죄, 손해배상청구 등) */
  searchTerm?: string;
}

const lawRefPluginKey = new PluginKey("lawRefDecoration");

// 주요 법령명 목록 (문단 내 법령명 추적용)
const LAW_NAME_PATTERN =
  /(형법|민법|상법|형사소송법|민사소송법|행정소송법|헌법|국세기본법|근로기준법|도로교통법|정보통신망법|개인정보\s?보호법|특정경제범죄\s?가중처벌\s?등에\s?관한\s?법률|성폭력범죄의\s?처벌\s?등에\s?관한\s?특례법|아동복지법|저작권법|특허법|부정경쟁방지법|독점규제\s?및\s?공정거래에\s?관한\s?법률|건축법|주택법|폭력행위\s?등\s?처벌에\s?관한\s?법률|국가보안법|군형법|약사법|의료법|식품위생법|환경보전법|산업안전보건법|노동조합법)/;

// 조문 패턴: "제123조", "제123조의2", "제123조 제2항"
const ARTICLE_PATTERN = /제(\d+)조(?:의(\d+))?(?:\s*제(\d+)항)?/g;

// 법률 용어 패턴: "XX죄" (2글자 이상 + 죄), "XX청구" (2글자 이상 + 청구)
// 범용 패턴 — 어떤 죄명이든, 어떤 청구 유형이든 감지
const LEGAL_TERM_PATTERN = /[가-힣]{2,}(?:죄|청구)/g;

/** blockText 내 offset → 실제 document position으로 변환하여 decoration 추가 */
function addDecoration(
  matchStart: number,
  matchEnd: number,
  textRanges: { from: number; to: number; text: string }[],
  attrs: Record<string, string>,
  decorations: Decoration[],
  decoratedRanges: [number, number][],
) {
  let blockOffset = 0;
  for (const range of textRanges) {
    const rangeLen = range.text.length;
    const rangeStart = blockOffset;
    const rangeEnd = blockOffset + rangeLen;

    const overlapStart = Math.max(matchStart, rangeStart);
    const overlapEnd = Math.min(matchEnd, rangeEnd);

    if (overlapStart < overlapEnd) {
      const decoFrom = range.from + (overlapStart - rangeStart);
      const decoTo = range.from + (overlapEnd - rangeStart);

      // 기존 decoration과 겹치면 건너뛰기
      if (decoratedRanges.some(([s, e]) => decoFrom < e && decoTo > s)) {
        blockOffset += rangeLen;
        continue;
      }

      decorations.push(
        Decoration.inline(decoFrom, decoTo, {
          class: "law-ref-link",
          nodeName: "span",
          ...attrs,
        })
      );
      decoratedRanges.push([decoFrom, decoTo]);
    }

    blockOffset += rangeLen;
  }
}

function buildDecorations(doc: ProseMirrorNode): Decoration[] {
  const decorations: Decoration[] = [];
  const decoratedRanges: [number, number][] = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;

    // 텍스트블록 내 전체 텍스트를 연결하여 법령명 추적
    let blockText = "";
    const textRanges: { from: number; to: number; text: string }[] = [];

    node.forEach((child, offset) => {
      if (child.isText && child.text) {
        const from = pos + 1 + offset;
        textRanges.push({ from, to: from + child.text.length, text: child.text });
        blockText += child.text;
      }
    });

    if (!blockText) return;

    // ── 1단계: 명시적 조문 참조 (형법 제319조 등) ──
    let currentLawName = "";
    const lawNamePositions: { index: number; name: string }[] = [];
    const lawNameRegex = new RegExp(LAW_NAME_PATTERN.source, "g");
    let lawMatch;
    while ((lawMatch = lawNameRegex.exec(blockText)) !== null) {
      lawNamePositions.push({ index: lawMatch.index, name: lawMatch[1] });
    }

    const articleRegex = new RegExp(ARTICLE_PATTERN.source, "g");
    let artMatch;

    while ((artMatch = articleRegex.exec(blockText)) !== null) {
      for (const lp of lawNamePositions) {
        if (lp.index < artMatch.index) {
          currentLawName = lp.name;
        }
      }
      if (!currentLawName) continue;

      const articleNum = artMatch[2] ? `${artMatch[1]}의${artMatch[2]}` : artMatch[1];
      const paragraph = artMatch[3] || undefined;

      addDecoration(
        artMatch.index,
        artMatch.index + artMatch[0].length,
        textRanges,
        {
          "data-law-name": currentLawName,
          "data-article-number": articleNum,
          ...(paragraph ? { "data-paragraph": paragraph } : {}),
        },
        decorations,
        decoratedRanges,
      );
    }

    // ── 2단계: 법률 용어 (XX죄, XX청구) ──
    const termRegex = new RegExp(LEGAL_TERM_PATTERN.source, "g");
    let termMatch;

    while ((termMatch = termRegex.exec(blockText)) !== null) {
      const term = termMatch[0];

      addDecoration(
        termMatch.index,
        termMatch.index + term.length,
        textRanges,
        { "data-search-term": term },
        decorations,
        decoratedRanges,
      );
    }
  });

  return decorations;
}

export const LawRefDecoration = Extension.create<{
  onLawRefClick?: (data: LawRefClickData) => void;
}>({
  name: "lawRefDecoration",

  addOptions() {
    return {
      onLawRefClick: undefined,
    };
  },

  addProseMirrorPlugins() {
    const ext = this;

    return [
      new Plugin({
        key: lawRefPluginKey,

        state: {
          init(_, { doc }) {
            return DecorationSet.create(doc, buildDecorations(doc));
          },
          apply(tr, oldSet) {
            if (tr.docChanged) {
              return DecorationSet.create(tr.doc, buildDecorations(tr.doc));
            }
            return oldSet.map(tr.mapping, tr.doc);
          },
        },

        props: {
          decorations(state) {
            return this.getState(state);
          },

          handleClick(view, pos, event) {
            const target = event.target as HTMLElement;
            const link = target.closest?.(".law-ref-link");
            if (!link) return false;

            const cb = ext.options.onLawRefClick;
            if (!cb) return false;

            // 법률 용어 검색 (XX죄, XX청구)
            const searchTerm = link.getAttribute("data-search-term");
            if (searchTerm) {
              cb({ searchTerm });
              return true;
            }

            // 명시적 조문 참조 (형법 제319조)
            const lawName = link.getAttribute("data-law-name");
            const articleNumber = link.getAttribute("data-article-number");
            if (!lawName || !articleNumber) return false;

            const paragraph = link.getAttribute("data-paragraph") || undefined;
            cb({ lawName, articleNumber, paragraph });
            return true;
          },
        },
      }),
    ];
  },
});
