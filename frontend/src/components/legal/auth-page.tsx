"use client";

import React from "react";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Scale, FileText, Search, BarChart3 } from "lucide-react";

interface AuthPageProps {
  onLogin: () => void;
}

export function AuthPage({ onLogin }: AuthPageProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin();
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Brand Section */}
      <div className="hidden lg:flex lg:w-1/2 bg-sidebar p-12 flex-col justify-between relative overflow-hidden">
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 opacity-[0.03]">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
              backgroundSize: "64px 64px",
            }}
          />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 text-sidebar-foreground">
            <div className="p-2 bg-sidebar-foreground/10 rounded-lg">
              <Scale className="h-7 w-7" />
            </div>
            <div>
              <span className="text-xl font-semibold tracking-tight">
                Casemate
              </span>
              <p className="text-sidebar-foreground/60 text-sm">
                Legal Intelligence Platform
              </p>
            </div>
          </div>
        </div>

        <div className="relative z-10 space-y-12">
          <div>
            <h2 className="text-sidebar-foreground text-3xl font-semibold tracking-tight leading-tight text-balance">
              법률 업무의 새로운 기준
            </h2>
            <p className="text-sidebar-foreground/60 mt-3 text-lg leading-relaxed">
              AI 기반 증거 분석과 판례 검색으로
              <br />
              업무 효율을 극대화하세요.
            </p>
          </div>

          <div className="space-y-6">
            {[
              {
                icon: FileText,
                title: "증거 자동 분석",
                desc: "이미지, PDF, 오디오 파일의 핵심 내용을 자동 추출",
              },
              {
                icon: Search,
                title: "판례 검색",
                desc: "유사 판례 매칭 및 심층 분석 제공",
              },
              {
                icon: BarChart3,
                title: "리스크 평가",
                desc: "사건별 승소 확률과 예상 결과 예측",
              },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-4">
                <div className="p-2.5 bg-sidebar-foreground/5 rounded-lg border border-sidebar-foreground/10">
                  <item.icon className="h-5 w-5 text-sidebar-foreground/80" />
                </div>
                <div>
                  <h3 className="text-sidebar-foreground font-medium">
                    {item.title}
                  </h3>
                  <p className="text-sidebar-foreground/50 text-sm mt-0.5">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-sidebar-foreground/40 text-sm">
          © 2026 Casemate. All rights reserved.
        </p>
      </div>

      {/* Right Side - Login/Signup Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-12 bg-background">
        <div className="w-full max-w-[400px]">
          {/* Mobile Logo */}
          <div className="flex items-center gap-2.5 lg:hidden mb-8">
            <div className="p-2 bg-foreground rounded-lg">
              <Scale className="h-5 w-5 text-background" />
            </div>
            <span className="text-lg font-semibold tracking-tight">
              Casemate
            </span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight">
              {mode === "login" ? "로그인" : "계정 만들기"}
            </h1>
            <p className="text-muted-foreground mt-2">
              {mode === "login"
                ? "계정에 로그인하여 서비스를 이용하세요"
                : "새 계정을 만들어 서비스를 시작하세요"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium">
                  이름
                </Label>
                <Input
                  id="name"
                  placeholder="홍길동"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-11"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                이메일
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="example@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">
                비밀번호
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11"
              />
            </div>
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="role" className="text-sm font-medium">
                  직업
                </Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="직업을 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lawyer">변호사</SelectItem>
                    <SelectItem value="legal-officer">법무사</SelectItem>
                    <SelectItem value="other">기타</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button type="submit" className="w-full h-11 mt-2 font-medium">
              {mode === "login" ? "로그인" : "회원가입"}
            </Button>
          </form>

          <div className="mt-8 text-center">
            {mode === "login" ? (
              <p className="text-sm text-muted-foreground">
                계정이 없으신가요?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className="text-foreground font-medium hover:underline underline-offset-4"
                >
                  회원가입
                </button>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                이미 계정이 있으신가요?{" "}
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className="text-foreground font-medium hover:underline underline-offset-4"
                >
                  로그인
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
