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

  const [showAiSummary, setShowAiSummary] = useState(false);

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
          <Button
            variant={showAiSummary ? "default" : "outline"}
            size="sm"
            onClick={() => setShowAiSummary(!showAiSummary)}
            className="gap-2 h-8"
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI 요약
            {showAiSummary ? (
              <PanelRightClose className="h-3.5 w-3.5" />
            ) : (
              <PanelRightOpen className="h-3.5 w-3.5" />
            )}
          </Button>
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
          className={`prose prose-sm max-w-none transition-all duration-300 ${showAiSummary ? "flex-1" : "w-full"}`}
        >
          <div className="whitespace-pre-wrap text-sm leading-relaxed font-sans text-foreground/80">
            {precedent.fullText}
          </div>
        </div>

        {/* AI Summary Panel */}
        {showAiSummary && (
          <div className="w-[380px] flex-shrink-0">
            <Card className="sticky top-4 border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                  AI 요약
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-5">
                <h3 className="font-medium text-sm leading-snug">
                  {precedent.similarityReport.title}
                </h3>

                {/* Result Summary */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">
                    결과 요약
                  </h4>
                  <ul className="space-y-1.5">
                    {precedent.similarityReport.resultSummary.map(
                      (item, index) => (
                        <li
                          key={index}
                          className="flex items-start gap-2 text-xs text-foreground/80"
                        >
                          <span className="text-muted-foreground mt-1">•</span>
                          <span>{item}</span>
                        </li>
                      )
                    )}
                  </ul>
                </div>

                {/* Facts */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">
                    사실관계
                  </h4>
                  <ul className="space-y-1.5">
                    {precedent.similarityReport.facts.map((item, index) => (
                      <li
                        key={index}
                        className="flex items-start gap-2 text-xs text-foreground/80"
                      >
                        <span className="text-muted-foreground mt-1">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Legal Analysis */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">
                    법리 분석
                  </h4>
                  <p className="text-xs text-foreground/80 leading-relaxed">
                    {precedent.similarityReport.legalAnalysis}
                  </p>
                </div>

                {/* Implications */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">
                    본 사건 시사점
                  </h4>
                  <p className="text-xs text-foreground/80 leading-relaxed">
                    {precedent.similarityReport.implications}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
