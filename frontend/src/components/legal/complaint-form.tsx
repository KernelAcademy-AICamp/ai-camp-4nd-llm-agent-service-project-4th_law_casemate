"use client";

import { useState } from "react";
import type { CaseData } from "@/lib/sample-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  Trash2,
  Sparkles,
  Loader2,
} from "lucide-react";

interface ComplaintFormProps {
  caseData: CaseData;
}

interface PartyInfo {
  name: string;
  ssn1: string;
  ssn2: string;
  address: string;
  phone: string;
}

interface ComplaintData {
  caseName: string;
  plaintiff: PartyInfo;
  defendants: PartyInfo[];
  claimAmount: string;
  stampFee: string;
  serviceFee: string;
  claimPurpose: string;
  claimReasons: string[];
  evidences: string[];
  attachments: string[];
  filingDate: string;
}

const emptyParty: PartyInfo = {
  name: "",
  ssn1: "",
  ssn2: "",
  address: "",
  phone: "",
};

export function ComplaintForm({ caseData }: ComplaintFormProps) {
  const [formData, setFormData] = useState<ComplaintData>({
    caseName: caseData.name || "",
    plaintiff: {
      name: caseData.client || "",
      ssn1: "",
      ssn2: "",
      address: "",
      phone: "",
    },
    defendants: [
      {
        name: caseData.opponent || "",
        ssn1: "",
        ssn2: "",
        address: "",
        phone: "",
      },
    ],
    claimAmount: caseData.claimAmount?.toString() || "",
    stampFee: "",
    serviceFee: "",
    claimPurpose: `1. 피고는 원고에게 금 ${caseData.claimAmount?.toLocaleString() || "____"}원 및 이에 대하여 소장부본 송달 다음 날부터 다 갚는 날까지 연 12%의 비율로 계산한 돈을 지급하라.
2. 소송비용은 피고가 부담한다.
3. 제1항은 가집행할 수 있다.
라는 판결을 구합니다.`,
    claimReasons: ["", "", ""],
    evidences: [""],
    attachments: [
      "소송비용(인지, 송달료)납부서 각 1부",
      "위 입증서류 각 1통",
      "소장부본 1부",
    ],
    filingDate: new Date().toISOString().split("T")[0],
  });

  const [isGenerating, setIsGenerating] = useState(false);

  // 피고 추가
  const addDefendant = () => {
    if (formData.defendants.length < 2) {
      setFormData((prev) => ({
        ...prev,
        defendants: [...prev.defendants, { ...emptyParty }],
      }));
    }
  };

  // 피고 삭제
  const removeDefendant = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      defendants: prev.defendants.filter((_, i) => i !== index),
    }));
  };

  // 청구원인 항목 추가
  const addClaimReason = () => {
    setFormData((prev) => ({
      ...prev,
      claimReasons: [...prev.claimReasons, ""],
    }));
  };

  // 청구원인 항목 삭제
  const removeClaimReason = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      claimReasons: prev.claimReasons.filter((_, i) => i !== index),
    }));
  };

  // 입증방법 항목 추가
  const addEvidence = () => {
    setFormData((prev) => ({
      ...prev,
      evidences: [...prev.evidences, ""],
    }));
  };

  // 입증방법 항목 삭제
  const removeEvidence = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      evidences: prev.evidences.filter((_, i) => i !== index),
    }));
  };

  // AI 생성 (목업)
  const handleAIGenerate = async () => {
    setIsGenerating(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    setFormData((prev) => ({
      ...prev,
      claimReasons: [
        `원고와 피고는 ${caseData.period || "2025년"}경 알게 된 사이로, 피고는 원고에 대하여 ${caseData.caseType || "명예훼손"} 행위를 하였습니다.`,
        `피고는 ${caseData.description || "온라인 게시글을 통해 원고의 명예를 훼손"}하였고, 이로 인해 원고는 정신적 고통을 받았습니다.`,
        `따라서 피고는 원고에게 위자료로서 금 ${caseData.claimAmount?.toLocaleString() || "____"}원을 지급할 의무가 있습니다.`,
      ],
    }));

    setIsGenerating(false);
  };

  return (
    <ScrollArea className="h-[calc(100vh-220px)]">
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        {/* 헤더 */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-widest">소 장</h1>
        </div>

        {/* 사건명 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">사건명</Label>
          <Input
            value={formData.caseName}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, caseName: e.target.value }))
            }
            placeholder="사건명을 입력하세요"
          />
        </div>

        <Separator />

        {/* 원고 정보 */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">원고</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">성명</Label>
                <Input
                  value={formData.plaintiff.name}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      plaintiff: { ...prev.plaintiff, name: e.target.value },
                    }))
                  }
                  placeholder="원고 성명"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">주민등록번호</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    value={formData.plaintiff.ssn1}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        plaintiff: { ...prev.plaintiff, ssn1: e.target.value },
                      }))
                    }
                    placeholder="앞 6자리"
                    maxLength={6}
                    className="w-24"
                  />
                  <span>-</span>
                  <Input
                    value={formData.plaintiff.ssn2}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        plaintiff: { ...prev.plaintiff, ssn2: e.target.value },
                      }))
                    }
                    placeholder="뒤 7자리"
                    maxLength={7}
                    type="password"
                    className="w-28"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">주소</Label>
              <Input
                value={formData.plaintiff.address}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    plaintiff: { ...prev.plaintiff, address: e.target.value },
                  }))
                }
                placeholder="주소를 입력하세요"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">연락 가능한 전화번호</Label>
              <Input
                value={formData.plaintiff.phone}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    plaintiff: { ...prev.plaintiff, phone: e.target.value },
                  }))
                }
                placeholder="010-0000-0000"
              />
            </div>
          </CardContent>
        </Card>

        {/* 피고 정보 */}
        {formData.defendants.map((defendant, index) => (
          <Card key={index}>
            <CardHeader className="py-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">피고 {index + 1}</CardTitle>
              {formData.defendants.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive"
                  onClick={() => removeDefendant(index)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">성명</Label>
                  <Input
                    value={defendant.name}
                    onChange={(e) => {
                      const newDefendants = [...formData.defendants];
                      newDefendants[index].name = e.target.value;
                      setFormData((prev) => ({ ...prev, defendants: newDefendants }));
                    }}
                    placeholder="피고 성명"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">주민등록번호</Label>
                  <div className="flex gap-2 items-center">
                    <Input
                      value={defendant.ssn1}
                      onChange={(e) => {
                        const newDefendants = [...formData.defendants];
                        newDefendants[index].ssn1 = e.target.value;
                        setFormData((prev) => ({ ...prev, defendants: newDefendants }));
                      }}
                      placeholder="앞 6자리"
                      maxLength={6}
                      className="w-24"
                    />
                    <span>-</span>
                    <Input
                      value={defendant.ssn2}
                      onChange={(e) => {
                        const newDefendants = [...formData.defendants];
                        newDefendants[index].ssn2 = e.target.value;
                        setFormData((prev) => ({ ...prev, defendants: newDefendants }));
                      }}
                      placeholder="뒤 7자리"
                      maxLength={7}
                      type="password"
                      className="w-28"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">주소</Label>
                <Input
                  value={defendant.address}
                  onChange={(e) => {
                    const newDefendants = [...formData.defendants];
                    newDefendants[index].address = e.target.value;
                    setFormData((prev) => ({ ...prev, defendants: newDefendants }));
                  }}
                  placeholder="주소를 입력하세요"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">연락 가능한 전화번호</Label>
                <Input
                  value={defendant.phone}
                  onChange={(e) => {
                    const newDefendants = [...formData.defendants];
                    newDefendants[index].phone = e.target.value;
                    setFormData((prev) => ({ ...prev, defendants: newDefendants }));
                  }}
                  placeholder="010-0000-0000"
                />
              </div>
            </CardContent>
          </Card>
        ))}

        {formData.defendants.length < 2 && (
          <Button variant="outline" size="sm" onClick={addDefendant} className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            피고 추가
          </Button>
        )}

        <Separator />

        {/* 소송비용 */}
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">소송목적의 값</Label>
            <div className="flex items-center gap-1">
              <Input
                value={formData.claimAmount}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, claimAmount: e.target.value }))
                }
                placeholder="금액"
              />
              <span className="text-sm">원</span>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">인지</Label>
            <div className="flex items-center gap-1">
              <Input
                value={formData.stampFee}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, stampFee: e.target.value }))
                }
                placeholder="금액"
              />
              <span className="text-sm">원</span>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">예납 송달료</Label>
            <div className="flex items-center gap-1">
              <Input
                value={formData.serviceFee}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, serviceFee: e.target.value }))
                }
                placeholder="금액"
              />
              <span className="text-sm">원</span>
            </div>
          </div>
        </div>

        <Separator />

        {/* 청구취지 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">청구취지</Label>
          <Textarea
            value={formData.claimPurpose}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, claimPurpose: e.target.value }))
            }
            rows={6}
            className="font-mono text-sm"
          />
        </div>

        <Separator />

        {/* 청구원인 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">청구원인</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAIGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              AI 생성
            </Button>
          </div>
          {formData.claimReasons.map((reason, index) => (
            <div key={index} className="flex gap-2 items-start">
              <span className="text-sm font-medium mt-2 w-6">{index + 1}.</span>
              <Textarea
                value={reason}
                onChange={(e) => {
                  const newReasons = [...formData.claimReasons];
                  newReasons[index] = e.target.value;
                  setFormData((prev) => ({ ...prev, claimReasons: newReasons }));
                }}
                rows={2}
                className="flex-1 text-sm"
                placeholder={`청구원인 ${index + 1}을 입력하세요`}
              />
              {formData.claimReasons.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => removeClaimReason(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addClaimReason}>
            <Plus className="h-4 w-4 mr-2" />
            항목 추가
          </Button>
        </div>

        <Separator />

        {/* 입증방법 */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">입증방법</Label>
          {formData.evidences.map((evidence, index) => (
            <div key={index} className="flex gap-2 items-center">
              <span className="text-sm font-medium w-6">{index + 1}.</span>
              <span className="text-sm">갑 제{index + 1}호증</span>
              <Input
                value={evidence}
                onChange={(e) => {
                  const newEvidences = [...formData.evidences];
                  newEvidences[index] = e.target.value;
                  setFormData((prev) => ({ ...prev, evidences: newEvidences }));
                }}
                placeholder="증거명"
                className="flex-1"
              />
              {formData.evidences.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => removeEvidence(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addEvidence}>
            <Plus className="h-4 w-4 mr-2" />
            증거 추가
          </Button>
        </div>

        <Separator />

        {/* 첨부서류 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">첨부서류</Label>
          <div className="space-y-1 text-sm text-muted-foreground">
            {formData.attachments.map((attachment, index) => (
              <p key={index}>1. {attachment}</p>
            ))}
          </div>
        </div>

        <Separator />

        {/* 날짜 및 서명 */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Label className="text-sm">제출일:</Label>
            <Input
              type="date"
              value={formData.filingDate}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, filingDate: e.target.value }))
              }
              className="w-40"
            />
          </div>
          <div className="text-right space-y-2">
            <p className="text-sm">
              원고 <span className="font-medium">{formData.plaintiff.name || "______"}</span> (서명 또는 날인)
            </p>
          </div>
        </div>

        <div className="text-center pt-4">
          <p className="text-sm font-medium">______ 법원 귀중</p>
        </div>
      </div>
    </ScrollArea>
  );
}
