"use client";

import { useState } from "react";
import type { CaseData } from "@/lib/sample-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText,
  Sparkles,
  Save,
  Download,
  Bold,
  Italic,
  List,
  AlignLeft,
  Plus,
  FolderOpen,
  Trash2,
  Copy,
  Loader2,
  Check,
  Scale,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DocumentEditorProps {
  caseData: CaseData;
}

const templates = [
  { id: "complaint", name: "소장", category: "소송" },
  { id: "brief", name: "준비서면", category: "소송" },
  { id: "opinion", name: "법률 의견서", category: "의견" },
  { id: "settlement", name: "합의서", category: "합의" },
  { id: "notice", name: "내용증명", category: "통지" },
];

const templateContents: Record<string, string> = {
  complaint: `소    장

원고 : [원고명]
피고 : [피고명]

청 구 취 지

1. 피고는 원고에게 금 [금액]원을 지급하라.
2. 소송비용은 피고가 부담한다.
3. 제 1항은 가집행할 수 있다.

라는 판결을 구합니다.

청 구 원 인

1. 당사자의 지위
   [내용 작성]

2. 사실관계
   [내용 작성]

3. 피고의 책임
   [내용 작성]

입 증 방 법

1. 갑 제1호증   [증거명]

첨 부 서 류

1. 소장부본        1통`,
  brief: `준 비 서 면

사건번호: [사건번호]
원고 : [원고명]
피고 : [피고명]

본 사건에 관하여 다음과 같이 준비서면을 제출합니다.

1. 피고 주장에 대한 반박
   [내용 작성]

2. 추가 주장
   [내용 작성]

3. 결론
   [내용 작성]`,
  opinion: `법 률 의 견 서

1. 사안의 개요
   [내용 작성]

2. 쟁점
   [내용 작성]

3. 검토 의견
   [내용 작성]

4. 결론
   [내용 작성]`,
  settlement: `합 의 서

[갑]과 [을]은 다음과 같이 합의한다.

제 1조 (합의 내용)
[내용 작성]

제 2조 (합의금)
[내용 작성]

제 3조 (기타)
[내용 작성]`,
  notice: `내 용 증 명

발신 : [발신인]
수신 : [수신인]
제목: [제목]

[내용 작성]`,
};

const initialDocuments = [
  { id: "1", title: "소장 초안 v1", template: "소장", updatedAt: "2026-01-28", content: "" },
  { id: "2", title: "준비서면 1차", template: "준비서면", updatedAt: "2026-01-25", content: "" },
];

export function DocumentEditor({ caseData }: DocumentEditorProps) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [documentTitle, setDocumentTitle] = useState("새 문서");
  const [documentContent, setDocumentContent] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [leftTab, setLeftTab] = useState<"docs" | "templates">("docs");

  const handleNewDocument = () => {
    setActiveDocId(null);
    setDocumentTitle("새 문서");
    setDocumentContent("");
    setIsSaved(false);
  };

  const handleSelectDocument = (doc: (typeof documents)[0]) => {
    setActiveDocId(doc.id);
    setDocumentTitle(doc.title);
    setDocumentContent(doc.content);
    setIsSaved(true);
  };

  const handleSelectTemplate = (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    if (template) {
      setActiveDocId(null);
      setDocumentTitle(`${template.name} - ${caseData.name}`);
      setDocumentContent(templateContents[templateId] || "");
      setIsSaved(false);
    }
  };

  const handleGenerateDraft = async () => {
    setIsGenerating(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const aiContent = `[AI 생성 초안]

사건명: ${caseData.name}
사건 유형: ${caseData.category}

1. 사안의 개요
본 사건은 ${caseData.category}에 관한 건으로, ${caseData.description}

2. 당사자 관계
${(caseData.parties || []).map((p) => `- ${p.name} (${p.role})`).join("\n")}

3. 주요 사실관계
${(caseData.timeline || []).map((t) => `- ${t.date}: ${t.event}`).join("\n")}

4. 법적 쟁점
[검토 필요]

5. 결론
[검토 필요]

---
본 내용은 AI가 작성한 초안입니다. 반드시 검토 후 수정하여 사용하세요.`;

    setDocumentContent(aiContent);
    setIsGenerating(false);
    setIsSaved(false);
  };

  const handleSave = () => {
    if (activeDocId) {
      setDocuments((docs) =>
        docs.map((d) =>
          d.id === activeDocId
            ? { ...d, title: documentTitle, content: documentContent, updatedAt: new Date().toISOString().split("T")[0] }
            : d
        )
      );
    } else {
      const newDoc = {
        id: Date.now().toString(),
        title: documentTitle,
        template: "",
        updatedAt: new Date().toISOString().split("T")[0],
        content: documentContent,
      };
      setDocuments((docs) => [newDoc, ...docs]);
      setActiveDocId(newDoc.id);
    }
    setIsSaved(true);
  };

  const handleDeleteDocument = (docId: string) => {
    setDocuments((docs) => docs.filter((d) => d.id !== docId));
    if (activeDocId === docId) handleNewDocument();
  };

  const handleDuplicateDocument = (doc: (typeof documents)[0]) => {
    const newDoc = {
      ...doc,
      id: Date.now().toString(),
      title: `${doc.title} (복사본)`,
      updatedAt: new Date().toISOString().split("T")[0],
    };
    setDocuments((docs) => [newDoc, ...docs]);
  };

  return (
    <div className="flex h-[calc(100vh-220px)] gap-3">
      {/* Left Panel */}
      <Card className="w-56 flex-shrink-0 flex flex-col">
        <CardHeader className="p-3 pb-2">
          <div className="flex gap-1">
            <Button
              variant={leftTab === "docs" ? "default" : "ghost"}
              size="sm"
              className="flex-1 text-xs h-7"
              onClick={() => setLeftTab("docs")}
            >
              <FolderOpen className="h-3 w-3 mr-1" />
              문서
            </Button>
            <Button
              variant={leftTab === "templates" ? "default" : "ghost"}
              size="sm"
              className="flex-1 text-xs h-7"
              onClick={() => setLeftTab("templates")}
            >
              <FileText className="h-3 w-3 mr-1" />
              템플릿
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-2 pt-0">
          <Button variant="outline" size="sm" className="w-full mb-2 gap-1 h-7 text-xs bg-transparent" onClick={handleNewDocument}>
            <Plus className="h-3 w-3" />새 문서
          </Button>

          <ScrollArea className="h-[calc(100%-36px)]">
            {leftTab === "docs" ? (
              <div className="space-y-1">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className={cn(
                      "group p-2 rounded cursor-pointer hover:bg-muted transition-colors",
                      activeDocId === doc.id && "bg-muted"
                    )}
                    onClick={() => handleSelectDocument(doc)}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{doc.title}</p>
                        <p className="text-[10px] text-muted-foreground">{doc.updatedAt}</p>
                      </div>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDuplicateDocument(doc);
                          }}
                        >
                          <Copy className="h-2.5 w-2.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteDocument(doc.id);
                          }}
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {documents.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">저장된 문서 없음</p>}
              </div>
            ) : (
              <div className="space-y-1">
                {templates.map((t) => (
                  <div
                    key={t.id}
                    className="p-2 rounded cursor-pointer hover:bg-muted transition-colors"
                    onClick={() => handleSelectTemplate(t.id)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs">{t.name}</span>
                      <Badge variant="outline" className="text-[10px] h-4 px-1">
                        {t.category}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Center - Editor */}
      <Card className="flex-1 flex flex-col">
        <CardHeader className="p-3 pb-2 border-b">
          <div className="flex items-center justify-between gap-3">
            <Input
              value={documentTitle}
              onChange={(e) => {
                setDocumentTitle(e.target.value);
                setIsSaved(false);
              }}
              className="text-sm font-medium border-none shadow-none px-0 h-7 focus-visible:ring-0"
              placeholder="문서 제목"
            />
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={handleGenerateDraft} disabled={isGenerating} className="gap-1 h-7 text-xs bg-transparent">
                {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                AI 초안
              </Button>
              <Button variant="outline" size="sm" onClick={handleSave} className="gap-1 h-7 text-xs bg-transparent">
                {isSaved ? <Check className="h-3 w-3 text-green-600" /> : <Save className="h-3 w-3" />}
                저장
              </Button>
              <Button variant="outline" size="sm" className="gap-1 h-7 text-xs bg-transparent">
                <Download className="h-3 w-3" />
                내보내기
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-0.5 mt-2 pt-2 border-t">
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <Bold className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <Italic className="h-3.5 w-3.5" />
            </Button>
            <div className="w-px h-4 bg-border mx-1" />
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <List className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <AlignLeft className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex-1 p-0 overflow-hidden">
          <Textarea
            value={documentContent}
            onChange={(e) => {
              setDocumentContent(e.target.value);
              setIsSaved(false);
            }}
            placeholder="왼쪽에서 템플릿을 선택하거나 AI 초안을 작성하세요."
            className="h-full w-full resize-none border-none rounded-none focus-visible:ring-0 font-mono text-sm leading-relaxed p-4"
          />
        </CardContent>
      </Card>

      {/* Right Panel */}
      <Card className="w-52 flex-shrink-0 flex flex-col">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs">사건 참조</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-2 pt-0">
          <ScrollArea className="h-full">
            <div className="space-y-3">
              <div>
                <h4 className="text-[10px] font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  관계인
                </h4>
                <div className="space-y-1">
                  {(caseData.parties || []).slice(0, 4).map((p, i) => (
                    <div key={i} className="p-1.5 bg-muted rounded text-[10px] flex justify-between">
                      <span>{p.name}</span>
                      <span className="text-muted-foreground">{p.role}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-[10px] font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Scale className="h-3 w-3" />
                  관련 판례
                </h4>
                <div className="space-y-1">
                  {["2023다12345", "2022가합67890"].map((c, i) => (
                    <div key={i} className="p-1.5 bg-muted rounded text-[10px]">
                      {c}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-[10px] font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  주요 증거
                </h4>
                <div className="space-y-1">
                  {["갑1호증-계약서", "갑2호증-채팅기록"].map((e, i) => (
                    <div key={i} className="p-1.5 bg-muted rounded text-[10px] truncate">
                      {e}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
