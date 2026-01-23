"use client";

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { type PrecedentData, samplePrecedents } from "@/lib/sample-data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Sparkles,
  PanelRightOpen,
  PanelRightClose,
} from "lucide-react";

interface PrecedentDetailPageProps {
  precedent?: PrecedentData;
}

export function PrecedentDetailPage({
  precedent: propPrecedent,
}: PrecedentDetailPageProps) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const precedent = propPrecedent || samplePrecedents.find(p => p.id.toString() === id) || samplePrecedents[0];


  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          className="h-9 px-3 -ml-3 text-muted-foreground hover:text-foreground"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          돌아가기
        </Button>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-xs font-normal">
            유사도 {precedent.similarity}%
          </Badge>
        </div>
      </div>

      {/* Title Section */}
      <div className="text-center space-y-2 max-w-3xl mx-auto">
        <h1 className="text-lg lg:text-xl font-semibold tracking-tight text-balance leading-relaxed">
          {precedent.title}
        </h1>
        <p className="text-sm text-muted-foreground">[{precedent.courtDate}]</p>
      </div>

      <Separator />

      {/* Content Area - Side by Side Layout */}
      <div className="flex gap-6">
        {/* Full Text Section */}
        <div
          className="prose prose-base max-w-none flex-[6]"
        >
          <div className="whitespace-pre-wrap text-[1.05rem] leading-loose font-sans text-foreground/80">
            {precedent.fullText}
          </div>
        </div>

        {/* AI Summary Panel */}
        <div className="flex-[4] min-w-[320px] flex-shrink-0 self-start sticky top-20">
          <Card className="border-border/60 max-h-[calc(100vh-8rem)] flex flex-col shadow-sm">
            <CardHeader className="pb-3 shrink-0">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                AI 요약
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-6 overflow-y-auto py-4 pt-0">
              <h3 className="font-semibold text-base leading-snug text-primary/90">
                {precedent.similarityReport.title}
              </h3>

              {/* Result Summary */}
              <div>
                <h4 className="text-[13px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                  결과 요약
                </h4>
                <ul className="space-y-2">
                  {precedent.similarityReport.resultSummary.map(
                    (item, index) => (
                      <li
                        key={index}
                        className="flex items-start gap-2 text-[14px] leading-6 text-foreground/80"
                      >
                        <span className="text-primary/60 mt-1">•</span>
                        <span>{item}</span>
                      </li>
                    )
                  )}
                </ul>
              </div>

              {/* Facts */}
              <div>
                <h4 className="text-[13px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                  사실관계
                </h4>
                <ul className="space-y-2">
                  {precedent.similarityReport.facts.map((item, index) => (
                    <li
                      key={index}
                      className="flex items-start gap-2 text-[14px] leading-6 text-foreground/80"
                    >
                      <span className="text-primary/60 mt-1">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Legal Analysis */}
              <div>
                <h4 className="text-[13px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                  법리 분석
                </h4>
                <p className="text-[14px] leading-6 text-foreground/80">
                  {precedent.similarityReport.legalAnalysis}
                </p>
              </div>

              {/* Implications */}
              <div>
                <h4 className="text-[13px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                  본 사건 시사점
                </h4>
                <p className="text-[14px] leading-6 text-foreground/80">
                  {precedent.similarityReport.implications}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
