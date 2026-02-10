"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { CaseData } from "@/lib/sample-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText,
  Sparkles,
  Save,
  Download,
  Bold,
  Italic,
  Underline,
  Heading2,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Indent,
  Outdent,
  Undo2,
  Redo2,
  Plus,
  FolderOpen,
  Trash2,
  Copy,
  Loader2,
  Check,
  Scale,
  Users,
  FileCheck,
  Mail,
  BookOpen,
  ClipboardList,
  Handshake,
  FilePen,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TiptapEditor } from "./tiptap-editor";
import type { Editor } from "@tiptap/react";

interface DocumentEditorProps {
  caseData: CaseData;
}

// AI 생성 가능한 문서 유형 (백엔드 document_api.py의 SYSTEM_PROMPTS 키와 일치해야 함)
const AI_SUPPORTED_TYPES = ["complaint", "notice", "civil_suit"];

const API_BASE = "http://localhost:8000/api/v1/documents";

// 검정색 col-resize 커서 (Windows 흰색 반전 방지)
const COL_RESIZE_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M8 2l-4 4h3v12H4l4 4 4-4H9V6h3L8 2z' fill='%23000'/%3E%3Cpath d='M16 2l4 4h-3v12h3l-4 4-4-4h3V6h-3l4-4z' fill='%23000'/%3E%3C/svg%3E") 12 12, col-resize`;

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("access_token");
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

const templates = [
  { id: "complaint", name: "고소장", category: "형사", icon: FileCheck },
  { id: "civil_suit", name: "소장 (손해배상)", category: "민사", icon: FilePen },
  { id: "notice", name: "내용증명", category: "통지", icon: Mail },
  { id: "brief", name: "준비서면", category: "소송", icon: ClipboardList },
  { id: "opinion", name: "법률 의견서", category: "의견", icon: BookOpen },
  { id: "settlement", name: "합의서", category: "합의", icon: Handshake },
];

const templateContents: Record<string, string> = {
  complaint: `<h1>고 \u00a0 소 \u00a0 장</h1>
<p><em>(고소장 기재사항 중 <strong>*</strong> 표시된 항목은 반드시 기재하여야 합니다.)</em></p>
<hr>
<h2>1. 고소인*</h2>
<table><tbody>
<tr><th>성 \u00a0 명<br>(상호‧대표자)</th><td></td><th>주민등록번호<br>(법인등록번호)</th><td>\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 - \u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0</td></tr>
<tr><th>주 \u00a0 소<br>(주사무소 소재지)</th><td colspan="3">\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0(현 거주지)</td></tr>
<tr><th>직 \u00a0 업</th><td></td><th>사무실<br>주소</th><td></td></tr>
<tr><th>전 \u00a0 화</th><td colspan="3">(휴대폰)\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 (자택)\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 (사무실)</td></tr>
<tr><th>이메일</th><td colspan="3"></td></tr>
<tr><th>대리인에<br>의한 고소</th><td colspan="3">☐ 법정대리인 (성명 :\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0, 연락처\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0)<br>☐ 고소대리인 (성명 : 변호사\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0, 연락처\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0)</td></tr>
</tbody></table>
<blockquote><p>※ 고소인이 법인 또는 단체인 경우에는 상호 또는 단체명, 대표자, 법인등록번호(또는 사업자등록번호), 주된 사무소의 소재지, 전화 등 연락처를 기재해야 하며, 법인의 경우에는 법인등기부 등본이 첨부되어야 합니다.</p></blockquote>
<blockquote><p>※ 미성년자의 친권자 등 법정대리인이 고소하는 경우 및 변호사에 의한 고소대리의 경우 법정대리인 관계, 변호사 선임을 증명할 수 있는 서류를 첨부하시기 바랍니다.</p></blockquote>
<hr>
<h2>2. 피고소인*</h2>
<table><tbody>
<tr><th>성 \u00a0 명</th><td></td><th>주민등록번호</th><td>\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 - \u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0</td></tr>
<tr><th>주 \u00a0 소</th><td colspan="3">\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0(현 거주지)</td></tr>
<tr><th>직 \u00a0 업</th><td></td><th>사무실<br>주소</th><td></td></tr>
<tr><th>전 \u00a0 화</th><td colspan="3">(휴대폰)\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 (자택)\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 (사무실)</td></tr>
<tr><th>이메일</th><td colspan="3"></td></tr>
<tr><th>기타사항</th><td colspan="3"><br><br></td></tr>
</tbody></table>
<blockquote><p>※ 피고소인에 대해 알고 있는 사항을 기재하여 주시기 바랍니다. 피고소인 인적사항 중 모르는 사항은 기재하지 않으셔도 되며, 피고소인 이름도 알지 못하는 경우 기타사항에 피고소인의 성별, 특징적 외모, 인상착의 등을 구체적으로 기재하시기 바랍니다.</p></blockquote>
<hr>
<h2>3. 고소취지*</h2>
<p><em>(죄명 및 피고소인에 대한 처벌의사 기재)</em></p>
<p>고소인은 피고소인을 <strong>○○죄</strong>로 고소하오니 처벌하여 주시기 바랍니다.*</p>
<p></p>
<hr>
<h2>4. 범죄사실*</h2>
<blockquote><p>※ 범죄사실은 형법 등 처벌법규에 해당하는 사실에 대하여 일시, 장소, 범행방법, 결과 등을 구체적으로 특정하여 기재해야 하며, 고소인이 알고 있는 지식과 경험, 증거에 의해 사실로 인정되는 내용을 기재하여야 합니다.</p></blockquote>
<p>[범죄사실 기재]</p><p></p>
<hr>
<h2>5. 고소이유</h2>
<blockquote><p>※ 고소이유에는 피고소인의 범행 경위 및 정황, 고소를 하게 된 동기와 사유 등 범죄사실을 뒷받침하는 내용을 간략, 명료하게 기재해야 합니다.</p></blockquote>
<p>[고소이유 기재]</p><p></p>
<hr>
<h2>6. 증거자료</h2>
<p><em>(■ 해당란에 체크하여 주시기 바랍니다)</em></p>
<ul><li>☐ 고소인은 고소인의 진술 외에 제출할 증거가 <strong>없습니다.</strong></li>
<li>☐ 고소인은 고소인의 진술 외에 제출할 증거가 <strong>있습니다.</strong></li></ul>
<p>\u00a0\u00a0\u00a0\u00a0☞ 제출할 증거의 세부내역은 별지를 작성하여 첨부합니다.</p>
<hr>
<h2>7. 관련사건의 수사 및 재판 여부*</h2>
<p><em>(■ 해당란에 체크하여 주시기 바랍니다)</em></p>
<table><tbody>
<tr><th>① 중복 고소 여부</th><td>본 고소장과 같은 내용의 고소장을 다른 검찰청 또는 경찰서에 제출하거나 제출하였던 사실이 있습니다 ☐ / 없습니다 ☐</td></tr>
<tr><th>② 관련 형사사건<br>\u00a0\u00a0 수사 \u00a0\u00a0 유무</th><td>본 고소장에 기재된 범죄사실과 관련된 사건 또는 공범에 대하여 검찰청이나 경찰서에서 수사 중에 있습니다 ☐ / 수사 중에 있지 않습니다 ☐</td></tr>
<tr><th>③ 관련 민사소송<br>\u00a0\u00a0 유 \u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 무</th><td>본 고소장에 기재된 범죄사실과 관련된 사건에 대하여 법원에서 민사소송 중에 있습니다 ☐ / 민사소송 중에 있지 않습니다 ☐</td></tr>
<tr><th>기타사항</th><td><br><br></td></tr>
</tbody></table>
<blockquote><p>※ ①, ②항은 반드시 표시하여야 하며, 만일 본 고소내용과 동일한 사건 또는 관련 형사사건이 수사‧재판 중이라면 어느 검찰청, 경찰서에서 수사 중인지, 어느 법원에서 재판 중인지 아는 범위에서 기타사항 난에 기재하여야 합니다.</p></blockquote>
<hr>
<h2>8. 기타</h2>
<h3 style="text-align: center">(고소내용에 대한 진실확약)</h3>
<p>본 고소장에 기재한 내용은 고소인이 알고 있는 지식과 경험을 바탕으로 모두 사실대로 작성하였으며, 만일 허위사실을 고소하였을 때에는 <strong>형법 제156조 무고죄</strong>로 처벌받을 것임을 서약합니다.</p>
<p></p>
<p style="text-align: center"><strong>\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0년 \u00a0\u00a0\u00a0\u00a0 월 \u00a0\u00a0\u00a0\u00a0\u00a0 일*</strong></p>
<p></p>
<table><tbody>
<tr><th>고소인</th><td>\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0(인)*</td></tr>
<tr><th>제출인</th><td>\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0(인)</td></tr>
</tbody></table>
<blockquote><p>※ 고소장 제출일을 기재하여야 하며, 고소인 난에는 고소인이 직접 자필로 서명 날(무)인 해야 합니다. 또한 법정대리인이나 변호사에 의한 고소대리의 경우에는 제출인을 기재하여야 합니다.</p></blockquote>
<p></p>
<p style="text-align: center"><strong>○○경찰서 귀중</strong></p>
<blockquote><p>※ 고소장은 가까운 경찰서에 제출하셔도 됩니다.</p></blockquote>
<hr>
<h1>별지 : 증거자료 세부 목록</h1>
<p><em>(범죄사실 입증을 위해 제출하려는 증거에 대하여 아래 각 증거별로 해당 난을 구체적으로 작성해 주시기 바랍니다)</em></p>
<hr>
<h2>1. 인적증거 (목격자, 기타 참고인 등)</h2>
<table><tbody>
<tr><th>성 \u00a0 명</th><td></td><th>주민등록번호</th><td>\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 - \u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0</td></tr>
<tr><th rowspan="2">주 \u00a0 소</th><td colspan="3">\u00a0자택 :</td></tr>
<tr><td colspan="3">\u00a0직장 :</td></tr>
<tr><th>직업</th><td colspan="3"></td></tr>
<tr><th>전 \u00a0 화</th><td colspan="3">(휴대폰)\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 (자택)\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 (사무실)</td></tr>
<tr><th>입증하려는<br>내용</th><td colspan="3"><br><br></td></tr>
</tbody></table>
<blockquote><p>※ 참고인의 인적사항과 연락처를 정확히 알 수 없으면 참고인을 특정할 수 있도록 성별, 외모 등을 '입증하려는 내용'란에 아는 대로 기재하시기 바랍니다.</p></blockquote>
<h2>2. 증거서류 (진술서, 차용증, 각서, 금융거래내역서, 진단서 등)</h2>
<table><tbody>
<tr><th>순번</th><th>증거</th><th>작성자</th><th>제출 유무</th></tr>
<tr><td>1</td><td></td><td></td><td>☐ 접수시 제출 \u00a0 ☐ 수사 중 제출</td></tr>
<tr><td>2</td><td></td><td></td><td>☐ 접수시 제출 \u00a0 ☐ 수사 중 제출</td></tr>
<tr><td>3</td><td></td><td></td><td>☐ 접수시 제출 \u00a0 ☐ 수사 중 제출</td></tr>
<tr><td>4</td><td></td><td></td><td>☐ 접수시 제출 \u00a0 ☐ 수사 중 제출</td></tr>
<tr><td>5</td><td></td><td></td><td>☐ 접수시 제출 \u00a0 ☐ 수사 중 제출</td></tr>
</tbody></table>
<blockquote><p>※ 증거란에 각 증거서류를 개별적으로 기재하고, 제출 유무란에는 고소장 접수시 제출하는지 또는 수사 중 제출할 예정인지 표시하시기 바랍니다.</p></blockquote>
<h2>3. 증거물</h2>
<table><tbody>
<tr><th>순번</th><th>증거</th><th>소유자</th><th>제출 유무</th></tr>
<tr><td>1</td><td></td><td></td><td>☐ 접수시 제출 \u00a0 ☐ 수사 중 제출</td></tr>
<tr><td>2</td><td></td><td></td><td>☐ 접수시 제출 \u00a0 ☐ 수사 중 제출</td></tr>
<tr><td>3</td><td></td><td></td><td>☐ 접수시 제출 \u00a0 ☐ 수사 중 제출</td></tr>
<tr><td>4</td><td></td><td></td><td>☐ 접수시 제출 \u00a0 ☐ 수사 중 제출</td></tr>
<tr><td>5</td><td></td><td></td><td>☐ 접수시 제출 \u00a0 ☐ 수사 중 제출</td></tr>
</tbody></table>
<blockquote><p>※ 증거란에 각 증거물을 개별적으로 기재하고, 소유자란에는 고소장 제출시 누가 소유하고 있는지, 제출 유무란에는 고소장 접수시 제출하는지 또는 수사 중 제출할 예정인지 표시하시기 바랍니다.</p></blockquote>
<h2>4. 기타 증거</h2>
<p>[기타 증거 기재]</p>`,

  civil_suit: `<h1>소    장</h1>
<h2>원고 / 피고</h2>
<table><tbody>
<tr><th>원고</th><td>[원고명]</td><th>주소</th><td></td></tr>
<tr><th>피고</th><td>[피고명]</td><th>주소</th><td></td></tr>
</tbody></table>
<h2>청 구 취 지</h2>
<ol><li>피고는 원고에게 금 [금액]원을 지급하라.</li>
<li>소송비용은 피고가 부담한다.</li>
<li>제 1항은 가집행할 수 있다.</li></ol>
<p>라는 판결을 구합니다.</p>
<h2>청 구 원 인</h2>
<h3>1. 당사자의 지위</h3>
<p>[내용 작성]</p>
<h3>2. 사실관계</h3>
<p>[내용 작성]</p>
<h3>3. 피고의 책임</h3>
<p>[내용 작성]</p>
<h2>입 증 방 법</h2>
<ol><li>갑 제1호증   [증거명]</li></ol>
<h2>첨 부 서 류</h2>
<ol><li>소장부본        1통</li></ol>`,

  brief: `<h1>준 비 서 면</h1>
<p><strong>사건번호</strong>: [사건번호]</p>
<table><tbody>
<tr><th>원고</th><td>[원고명]</td></tr>
<tr><th>피고</th><td>[피고명]</td></tr>
</tbody></table>
<p>본 사건에 관하여 다음과 같이 준비서면을 제출합니다.</p>
<h2>1. 피고 주장에 대한 반박</h2>
<p>[내용 작성]</p>
<h2>2. 추가 주장</h2>
<p>[내용 작성]</p>
<h2>3. 결론</h2>
<p>[내용 작성]</p>`,

  opinion: `<h1>법 률 의 견 서</h1>
<h2>1. 사안의 개요</h2>
<p>[내용 작성]</p>
<h2>2. 쟁점</h2>
<p>[내용 작성]</p>
<h2>3. 검토 의견</h2>
<p>[내용 작성]</p>
<h2>4. 결론</h2>
<p>[내용 작성]</p>`,

  settlement: `<h1>합 의 서</h1>
<p><strong>[갑]</strong>과 <strong>[을]</strong>은 다음과 같이 합의한다.</p>
<h2>제 1조 (합의 내용)</h2>
<p>[내용 작성]</p>
<h2>제 2조 (합의금)</h2>
<p>[내용 작성]</p>
<h2>제 3조 (기타)</h2>
<p>[내용 작성]</p>`,

  notice: `<h1>내 용 증 명</h1>
<h2>발신인 / 수신인</h2>
<table><tbody>
<tr><th>발신인</th><td>[발신인]</td></tr>
<tr><th>수신인</th><td>[수신인]</td></tr>
</tbody></table>
<h2>제목</h2>
<p>[제목]</p>
<h2>본문</h2>
<h3>피해 사실</h3>
<p>[내용 작성]</p>
<h3>시정 요구</h3>
<p>[내용 작성]</p>
<h3>법적 조치 경고</h3>
<p>[내용 작성]</p>
<h2>날짜</h2>
<p>[날짜]</p>`,
};

// 백엔드 GET /context/{case_id} 응답 타입
interface CaseContext {
  case: {
    title: string;
    client_name: string;
    client_role: string;
    opponent_name: string;
    opponent_role: string;
    case_type: string;
    description: string;
  };
  analysis: {
    summary: string | null;
    facts: string[] | string | null;
    claims: Record<string, unknown> | string | null;
    legal_keywords: string[];
    legal_laws: string[];
  };
  evidences: Array<{
    file_name: string;
    doc_type: string;
    description: string;
  }>;
  timeline: Array<{
    date: string;
    title: string;
    description: string;
  }>;
}

// GPT 섹션 생성 응답 타입
interface GeneratedSections {
  crime_facts: string;
  complaint_reason: string;
  charge_detail: string;
}

/**
 * GPT가 생성한 서술형 텍스트를 템플릿에 삽입
 * - 범죄사실, 고소이유, 고소취지 상세
 */
function insertNarrativeSections(html: string, sections: GeneratedSections): string {
  const AI = (text: string) => `<span data-ai-filled="true">${text}</span>`;

  // 범죄사실: [범죄사실 기재] → GPT 텍스트
  html = html.replace(
    /<p>\[범죄사실 기재\]<\/p>/,
    `<p>${AI(sections.crime_facts)}</p>`
  );

  // 고소이유: [고소이유 기재] → GPT 텍스트
  html = html.replace(
    /<p>\[고소이유 기재\]<\/p>/,
    `<p>${AI(sections.complaint_reason)}</p>`
  );

  // 고소취지 상세: 기존 고소취지 문단 뒤에 추가
  if (sections.charge_detail) {
    html = html.replace(
      /(처벌하여 주시기 바랍니다\.\*<\/p>\n<p><\/p>)/,
      `$1\n<p>${AI(sections.charge_detail)}</p>`
    );
  }

  return html;
}

/**
 * DB 컨텍스트 데이터를 고소장 HTML 템플릿에 자동 기입 (1단계)
 * - 고소인/피고소인 성명, ○○죄, 증거 체크, 별지 증거서류 등
 */
const AI = (text: string) => `<span data-ai-filled="true">${text}</span>`;

function buildFilledComplaint(context: CaseContext): string {
  let html = templateContents.complaint;
  const c = context.case;
  const evidences = context.evidences;
  const hasEvidence = evidences.length > 0;

  // 1. 고소인 성명
  html = html.replace(
    /(성 \u00a0 명<br>\(상호‧대표자\)<\/th>)<td><\/td>/,
    `$1<td>${AI(c.client_name)}</td>`
  );

  // 2. 피고소인 성명
  html = html.replace(
    /(2\. 피고소인\*<\/h2>[\s\S]*?성 \u00a0 명<\/th>)<td><\/td>/,
    `$1<td>${AI(c.opponent_name)}</td>`
  );

  // 3. 피고소인 기타사항 (관계)
  html = html.replace(
    /(기타사항<\/th>)<td colspan="3"><br><br><\/td>/,
    `$1<td colspan="3">${AI(`고소인과의 관계: ${c.opponent_role}`)}</td>`
  );

  // 4. ○○죄 → 실제 죄명
  const crimeName = c.case_type.includes("죄") ? c.case_type : `${c.case_type}죄`;
  html = html.replace(
    /<strong>○○죄<\/strong>/,
    `<strong>${AI(crimeName)}</strong>`
  );

  // 5. 증거자료 체크란
  if (hasEvidence) {
    html = html.replace(
      /☐ 고소인은 고소인의 진술 외에 제출할 증거가 <strong>있습니다\.<\/strong>/,
      `☑ 고소인은 고소인의 진술 외에 제출할 증거가 <strong>있습니다.</strong>`
    );
  } else {
    html = html.replace(
      /☐ 고소인은 고소인의 진술 외에 제출할 증거가 <strong>없습니다\.<\/strong>/,
      `☑ 고소인은 고소인의 진술 외에 제출할 증거가 <strong>없습니다.</strong>`
    );
  }

  // 6. 별지 증거서류 테이블
  if (hasEvidence) {
    const evidenceDocRows = evidences.map((ev, i) =>
      `<tr><td>${i + 1}</td><td>${AI(`갑 제${i + 1}호증: ${ev.file_name} (${ev.doc_type})`)}</td><td></td><td>☐ 접수시 제출 \u00a0 ☐ 수사 중 제출</td></tr>`
    ).join("\n");

    html = html.replace(
      /(2\. 증거서류[^<]*<\/h2>\n<table><tbody>\n<tr><th>순번<\/th><th>증거<\/th><th>작성자<\/th><th>제출 유무<\/th><\/tr>)\n(?:<tr><td>\d+<\/td><td><\/td><td><\/td><td>☐ 접수시 제출 \u00a0 ☐ 수사 중 제출<\/td><\/tr>\n?)+/,
      `$1\n${evidenceDocRows}\n`
    );
  }

  // 7. 하단 고소인 서명란
  html = html.replace(
    /(고소인<\/th><td>)\u00a0{30}\(인\)\*/,
    `$1${AI(c.client_name)}\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0(인)*`
  );

  return html;
}

interface DocumentItem {
  id: string;
  title: string;
  document_type: string;
  updated_at: string;
}

export function DocumentEditor({ caseData }: DocumentEditorProps) {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [documentTitle, setDocumentTitle] = useState("새 문서");
  const [documentContent, setDocumentContent] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<"docs" | "templates">("docs");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [contentSource, setContentSource] = useState<"template" | "ai" | "user">("template");

  // 양쪽 패널 리사이즈
  const [leftPanelWidth, setLeftPanelWidth] = useState(224);
  const [rightPanelWidth, setRightPanelWidth] = useState(288);
  const resizingPanel = useRef<"left" | "right" | null>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleResizeStart = useCallback((e: React.MouseEvent, panel: "left" | "right") => {
    resizingPanel.current = panel;
    startX.current = e.clientX;
    startWidth.current = panel === "left" ? leftPanelWidth : rightPanelWidth;
    document.body.style.cursor = COL_RESIZE_CURSOR;
    document.body.style.userSelect = "none";
  }, [leftPanelWidth, rightPanelWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingPanel.current) return;
      if (resizingPanel.current === "left") {
        const delta = e.clientX - startX.current;
        setLeftPanelWidth(Math.min(Math.max(startWidth.current + delta, 160), 400));
      } else {
        const delta = startX.current - e.clientX;
        setRightPanelWidth(Math.min(Math.max(startWidth.current + delta, 200), 480));
      }
    };

    const handleMouseUp = () => {
      if (resizingPanel.current) {
        resizingPanel.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // 문서 목록 불러오기
  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/case/${caseData.id}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      setDocuments(
        data.map((d: { id: number; title: string; document_type: string; updated_at: string }) => ({
          id: String(d.id),
          title: d.title,
          document_type: d.document_type,
          updated_at: d.updated_at?.split("T")[0] || "",
        }))
      );
    } catch {
      // 서버 미연결 시 조용히 실패
    }
  }, [caseData.id]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleNewDocument = () => {
    setActiveDocId(null);
    setDocumentTitle("새 문서");
    setDocumentContent("");
    setSelectedTemplate(null);
    setIsSaved(false);
    setContentSource("template");
  };

  const handleSelectDocument = async (doc: DocumentItem) => {
    try {
      const res = await fetch(`${API_BASE}/${doc.id}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setActiveDocId(String(data.id));
      setDocumentTitle(data.title);
      setDocumentContent(data.content || "");
      setSelectedTemplate(data.document_type);
      setIsSaved(true);
    } catch {
      // fallback: 목록 정보만 사용
      setActiveDocId(doc.id);
      setDocumentTitle(doc.title);
      setDocumentContent("");
      setIsSaved(true);
    }
  };

  const handleSelectTemplate = (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    if (template) {
      setActiveDocId(null);
      setSelectedTemplate(templateId);
      setDocumentTitle(`${template.name} - ${caseData.name}`);
      setIsSaved(false);
      setContentSource("template");

      if (templateId === "complaint") {
        setDocumentContent(templateContents[templateId] || "");
      } else {
        setDocumentContent(`<p style="text-align: center; color: #999; padding-top: 4rem; font-size: 1.1rem;">양식 준비 중</p>`);
      }
    }
  };

  const handleGenerateDraft = async () => {
    if (selectedTemplate !== "complaint") return;

    setIsGenerating(true);

    try {
      // ── 1단계: DB 컨텍스트로 구조화 필드 채움 (API 호출 없음) ──
      const ctxRes = await fetch(`${API_BASE}/context/${caseData.id}`, {
        headers: getAuthHeaders(),
      });
      if (!ctxRes.ok) throw new Error("사건 데이터를 불러올 수 없습니다.");

      const context: CaseContext = await ctxRes.json();
      let filledHtml = buildFilledComplaint(context);
      setDocumentTitle(`고소장 - ${context.case.title}`);
      setDocumentContent(filledHtml);
      setContentSource("ai");

      // ── 2단계: GPT로 서술형 섹션 생성 (1회 호출) ──
      const sectionsRes = await fetch(`${API_BASE}/generate-sections`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ case_id: Number(caseData.id) }),
      });

      if (sectionsRes.ok) {
        const sections: GeneratedSections = await sectionsRes.json();
        filledHtml = insertNarrativeSections(filledHtml, sections);
        setDocumentContent(filledHtml);
      }
    } catch (err) {
      console.error("문서 생성 오류:", err);
      alert(err instanceof Error ? err.message : "문서 생성 중 오류가 발생했습니다.");
    } finally {
      setIsGenerating(false);
      setIsSaved(false);
    }
  };

  const handleSave = async () => {
    try {
      if (activeDocId) {
        // 기존 문서 수정
        const res = await fetch(`${API_BASE}/${activeDocId}`, {
          method: "PUT",
          headers: getAuthHeaders(),
          body: JSON.stringify({ title: documentTitle, content: documentContent }),
        });
        if (!res.ok) throw new Error("저장에 실패했습니다.");
      } else {
        // 새 문서 생성
        const res = await fetch(`${API_BASE}/`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            case_id: Number(caseData.id),
            title: documentTitle,
            document_type: selectedTemplate || "complaint",
            content: documentContent,
          }),
        });
        if (!res.ok) throw new Error("저장에 실패했습니다.");
        const data = await res.json();
        setActiveDocId(String(data.id));
      }
      setIsSaved(true);
      setContentSource("user");
      fetchDocuments();
    } catch (err) {
      console.error("저장 오류:", err);
      alert(err instanceof Error ? err.message : "저장 중 오류가 발생했습니다.");
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    try {
      await fetch(`${API_BASE}/${docId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      fetchDocuments();
      if (activeDocId === docId) handleNewDocument();
    } catch {
      // 조용히 실패
    }
  };

  const handleDuplicateDocument = async (doc: DocumentItem) => {
    try {
      // 원본 문서 내용 가져오기
      const res = await fetch(`${API_BASE}/${doc.id}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();

      // 복사본 생성
      const copyRes = await fetch(`${API_BASE}/`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          case_id: Number(caseData.id),
          title: `${data.title} (복사본)`,
          document_type: data.document_type,
          content: data.content || "",
        }),
      });
      if (copyRes.ok) fetchDocuments();
    } catch {
      // 조용히 실패
    }
  };

  const handleExport = () => {
    const htmlDoc = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>${documentTitle || "문서"}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap');
body{font-family:'Noto Sans KR',sans-serif;font-size:10pt;color:#000;line-height:1.6;max-width:210mm;margin:0 auto;padding:15mm 20mm}
h1{text-align:center;font-size:22pt;font-weight:700;letter-spacing:12pt;margin:12pt 0}
h2{font-size:10.5pt;font-weight:700;margin:12pt 0 4pt}
table{width:100%;border-collapse:collapse;margin:4pt 0}
th,td{border:1px solid #000;padding:4pt 6pt;font-size:9.5pt;vertical-align:middle}
th{background:#f5f5f5;font-weight:500;text-align:center;white-space:nowrap}
blockquote{font-size:8pt;color:#333;border-left:3px solid #ccc;padding-left:8pt;margin:4pt 0}
hr{border:none;border-top:1px solid #000;margin:10pt 0}
</style></head><body>${documentContent}</body></html>`;
    const blob = new Blob([htmlDoc], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${documentTitle || "document"}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 툴바 버튼 helper
  const ToolbarButton = ({
    icon: Icon,
    title,
    onClick,
    isActive = false,
    disabled = false,
  }: {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    onClick: () => void;
    isActive?: boolean;
    disabled?: boolean;
  }) => (
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-7 w-7 rounded-md", isActive && "bg-muted text-foreground")}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );

  return (
    <div className="flex h-[calc(100vh-220px)]">
      {/* Left Panel */}
      <div
        className={cn(
          "flex-shrink-0 flex flex-col relative transition-all duration-200",
          leftCollapsed ? "w-9 items-center pt-1 gap-2" : "pr-1"
        )}
        style={leftCollapsed ? undefined : { width: leftPanelWidth }}
      >
        {leftCollapsed ? (
          <div className="flex flex-col items-center gap-1.5 pt-0.5">
            <button type="button" onClick={() => { setLeftCollapsed(false); setLeftTab("docs"); }} className="p-1.5 rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors" title="문서">
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => { setLeftCollapsed(false); setLeftTab("templates"); }} className="p-1.5 rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors" title="템플릿">
              <FileText className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => { setLeftCollapsed(false); handleNewDocument(); }} className="p-1.5 rounded-md hover:bg-primary/10 text-primary hover:text-primary transition-colors" title="새 문서">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <>
          <div className="flex gap-1 mb-3">
            <button
              type="button"
              className={cn(
                "flex-1 text-xs py-1.5 rounded-md font-medium transition-colors",
                leftTab === "docs"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
              onClick={() => setLeftTab("docs")}
            >
              <FolderOpen className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
              문서
            </button>
            <button
              type="button"
              className={cn(
                "flex-1 text-xs py-1.5 rounded-md font-medium transition-colors",
                leftTab === "templates"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
              onClick={() => setLeftTab("templates")}
            >
              <FileText className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
              템플릿
            </button>
          </div>

          <button
            type="button"
            onClick={handleNewDocument}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold py-2.5 my-1 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/15 hover:border-primary/50 transition-colors mb-3"
          >
            <Plus className="h-3.5 w-3.5" />
            새 문서 작성
          </button>

          <ScrollArea className="flex-1">
            {leftTab === "docs" ? (
              <div className="space-y-1">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className={cn(
                      "group p-2.5 rounded-lg cursor-pointer transition-colors",
                      activeDocId === doc.id
                        ? "bg-primary/8 text-foreground"
                        : "hover:bg-muted/60"
                    )}
                    onClick={() => handleSelectDocument(doc)}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{doc.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{doc.updated_at}</p>
                      </div>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-muted"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDuplicateDocument(doc);
                          }}
                        >
                          <Copy className="h-3 w-3 text-muted-foreground" />
                        </button>
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-muted"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteDocument(doc.id);
                          }}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {documents.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">저장된 문서가 없습니다</p>
                )}
              </div>
            ) : (
              <div className="space-y-0.5">
                {templates.map((t) => {
                  const Icon = t.icon;
                  return (
                    <div
                      key={t.id}
                      className="flex items-center gap-2.5 p-2.5 rounded-lg cursor-pointer hover:bg-muted/60 transition-colors"
                      onClick={() => handleSelectTemplate(t.id)}
                    >
                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-xs font-medium">{t.name}</span>
                      <span className="text-[11px] text-muted-foreground ml-auto">{t.category}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
          </>
        )}
      </div>

      {/* Left Divider */}
      <div
        className="relative flex-shrink-0 w-4 group/lh flex flex-col items-center z-20"
        style={{ cursor: COL_RESIZE_CURSOR }}
        onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button')) return; handleResizeStart(e, "left"); }}
      >
        {/* 항상 보이는 구분선 */}
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover/lh:w-[2px] group-hover/lh:bg-primary/30 transition-all" />
        {/* 접기/펼치기 버튼 (중앙) */}
        <div className="relative z-10 flex-1" />
        <button
          type="button"
          onClick={() => setLeftCollapsed(!leftCollapsed)}
          className="relative z-10 w-5 h-6 flex items-center justify-center text-muted-foreground hover:text-primary bg-background border border-border rounded-sm shadow-sm hover:bg-primary/5 transition-colors"
        >
          {leftCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
        <div className="relative z-10 flex-1" />
      </div>

      {/* Center - Editor */}
      <div className="flex-1 flex flex-col px-4">
        {/* Title + Actions */}
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-border/40">
          <Input
            value={documentTitle}
            onChange={(e) => {
              setDocumentTitle(e.target.value);
              setIsSaved(false);
            }}
            className="text-sm font-semibold border-none shadow-none pl-4 pr-0 h-8 focus-visible:ring-0"
            placeholder="문서 제목"
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateDraft}
              disabled={isGenerating || !selectedTemplate === "complaint"}
              className="gap-1.5 h-8 text-xs"
              style={!isGenerating && selectedTemplate === "complaint" ? {
                background: "linear-gradient(135deg, #6D5EF5, #8B7AF7)",
                color: "#fff",
                borderColor: "transparent",
              } : undefined}
            >
              {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {isGenerating ? "생성 중..." : "AI 초안"}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSave} className="gap-1 h-8 text-xs">
              {isSaved ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Save className="h-3.5 w-3.5" />}
              저장
            </Button>
            <Button variant="ghost" size="sm" className="gap-1 h-8 text-xs" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" />
              내보내기
            </Button>
          </div>
        </div>

        {/* Formatting Toolbar */}
        <div className="flex items-center gap-0.5 py-2 border-b border-border/30">
          <ToolbarButton
            icon={Undo2}
            title="실행취소"
            onClick={() => editor?.chain().focus().undo().run()}
            disabled={!editor}
          />
          <ToolbarButton
            icon={Redo2}
            title="다시실행"
            onClick={() => editor?.chain().focus().redo().run()}
            disabled={!editor}
          />
          <div className="w-px h-4 bg-border/50 mx-1.5" />
          <ToolbarButton
            icon={Heading2}
            title="제목"
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            isActive={editor?.isActive("heading", { level: 2 }) ?? false}
            disabled={!editor}
          />
          <ToolbarButton
            icon={Bold}
            title="굵게"
            onClick={() => editor?.chain().focus().toggleBold().run()}
            isActive={editor?.isActive("bold") ?? false}
            disabled={!editor}
          />
          <ToolbarButton
            icon={Italic}
            title="기울임"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            isActive={editor?.isActive("italic") ?? false}
            disabled={!editor}
          />
          <ToolbarButton
            icon={Underline}
            title="밑줄"
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
            isActive={editor?.isActive("underline") ?? false}
            disabled={!editor}
          />
          <div className="w-px h-4 bg-border/50 mx-1.5" />
          <ToolbarButton
            icon={ListOrdered}
            title="번호 목록"
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            isActive={editor?.isActive("orderedList") ?? false}
            disabled={!editor}
          />
          <ToolbarButton
            icon={List}
            title="글머리 목록"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            isActive={editor?.isActive("bulletList") ?? false}
            disabled={!editor}
          />
          <ToolbarButton
            icon={Indent}
            title="들여쓰기"
            onClick={() => editor?.chain().focus().sinkListItem("listItem").run()}
            disabled={!editor}
          />
          <ToolbarButton
            icon={Outdent}
            title="내어쓰기"
            onClick={() => editor?.chain().focus().liftListItem("listItem").run()}
            disabled={!editor}
          />
          <div className="w-px h-4 bg-border/50 mx-1.5" />
          <ToolbarButton
            icon={AlignLeft}
            title="왼쪽 정렬"
            onClick={() => editor?.chain().focus().setTextAlign("left").run()}
            isActive={editor?.isActive({ textAlign: "left" }) ?? false}
            disabled={!editor}
          />
          <ToolbarButton
            icon={AlignCenter}
            title="가운데 정렬"
            onClick={() => editor?.chain().focus().setTextAlign("center").run()}
            isActive={editor?.isActive({ textAlign: "center" }) ?? false}
            disabled={!editor}
          />
          <ToolbarButton
            icon={AlignRight}
            title="오른쪽 정렬"
            onClick={() => editor?.chain().focus().setTextAlign("right").run()}
            isActive={editor?.isActive({ textAlign: "right" }) ?? false}
            disabled={!editor}
          />
        </div>

        {/* Editor Area */}
        <div className="flex-1 overflow-hidden pt-3">
          <TiptapEditor
            initialContent={documentContent}
            onChange={(md) => {
              setDocumentContent(md);
              setIsSaved(false);
              if (contentSource === "ai") setContentSource("user");
            }}
            onEditorReady={setEditor}
            placeholder="왼쪽에서 템플릿을 선택하거나 AI 초안을 생성하세요."
            className={cn(
              "h-full w-full rounded-lg border border-border/50 bg-white focus-within:ring-1 focus-within:ring-primary/30 focus-within:border-primary/40 text-sm leading-relaxed",
              ""
            )}
          />
        </div>
      </div>

      {/* Right Divider */}
      <div
        className="relative flex-shrink-0 w-4 group/rh flex flex-col items-center z-20"
        style={{ cursor: COL_RESIZE_CURSOR }}
        onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button')) return; handleResizeStart(e, "right"); }}
      >
        {/* 항상 보이는 구분선 */}
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover/rh:w-[2px] group-hover/rh:bg-primary/30 transition-all" />
        {/* 접기/펼치기 버튼 (중앙) */}
        <div className="relative z-10 flex-1" />
        <button
          type="button"
          onClick={() => setRightCollapsed(!rightCollapsed)}
          className="relative z-10 w-5 h-6 flex items-center justify-center text-muted-foreground hover:text-primary bg-background border border-border rounded-sm shadow-sm hover:bg-primary/5 transition-colors"
        >
          {rightCollapsed ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <div className="relative z-10 flex-1" />
      </div>

      {/* Right Panel */}
      <div
        className={cn(
          "flex-shrink-0 flex flex-col relative transition-all duration-200",
          rightCollapsed ? "w-9 items-center pt-1" : ""
        )}
        style={rightCollapsed ? undefined : { width: rightPanelWidth }}
      >
        {rightCollapsed ? (
          <div className="flex flex-col items-center gap-1.5 pt-0.5">
            <button type="button" onClick={() => setRightCollapsed(false)} className="p-1.5 rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors" title="관계인">
              <Users className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setRightCollapsed(false)} className="p-1.5 rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors" title="관련 판례">
              <Scale className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setRightCollapsed(false)} className="p-1.5 rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors" title="주요 증거">
              <FileCheck className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 flex flex-col pl-2">
              <p className="text-xs font-semibold text-muted-foreground mb-3">사건 참조</p>
              <ScrollArea className="flex-1">
                <div className="space-y-5">
                  <div>
                    <h4 className="text-[11px] font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Users className="h-3 w-3" />
                      관계인
                    </h4>
                    <div className="space-y-1.5">
                      {caseData.client && caseData.opponent ? (
                        <>
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-medium">{caseData.client}</span>
                            <span className="text-muted-foreground">의뢰인</span>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-medium">{caseData.opponent}</span>
                            <span className="text-muted-foreground">상대방</span>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">데이터 없음</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[11px] font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Scale className="h-3 w-3" />
                      사건 정보
                    </h4>
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-muted-foreground">유형</span>
                        <span className="font-medium">{caseData.caseType || "미분류"}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-muted-foreground">상태</span>
                        <span className="font-medium">{caseData.status || "-"}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-muted-foreground">증거</span>
                        <span className="font-medium">{caseData.evidenceCount || 0}건</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[11px] font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                      <FileText className="h-3 w-3" />
                      사건 개요
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {caseData.description
                        ? caseData.description.slice(0, 200) + (caseData.description.length > 200 ? "..." : "")
                        : "사건 설명이 없습니다."}
                    </p>
                  </div>
                </div>
              </ScrollArea>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
