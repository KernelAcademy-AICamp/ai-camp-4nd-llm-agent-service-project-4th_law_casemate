"use client";

import React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Scale, Loader2, FileText, Search, MessageSquare } from "lucide-react";

interface AuthPageProps {
  onLogin: () => void | Promise<void>;
  exiting?: boolean;
}

const features = [
  { icon: FileText, text: "AI 사건 분석 · 핵심 쟁점 추출" },
  { icon: Search, text: "판례 검색 · 유사 판례 비교 분석" },
  { icon: MessageSquare, text: "AI 어시스턴트 · 법률 업무 자동화" },
];

export function AuthPage({ onLogin, exiting = false }: AuthPageProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [firmCode, setFirmCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === "signup" && !firmCode.trim()) {
      alert("회사 코드를 입력해주세요.");
      return;
    }

    setIsLoading(true);

    try {
      if (mode === "login") {
        const response = await fetch("http://localhost:8000/api/v1/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || "로그인에 실패했습니다");
        }

        localStorage.setItem("access_token", data.access_token);

        const userResponse = await fetch("http://localhost:8000/api/v1/me", {
          headers: { Authorization: `Bearer ${data.access_token}` },
        });

        if (userResponse.ok) {
          const userData = await userResponse.json();
          localStorage.setItem("user_email", userData.email);
          localStorage.setItem("user_id", userData.id);
          await onLogin();
        } else {
          throw new Error("사용자 정보를 가져오는데 실패했습니다");
        }
      } else {
        const response = await fetch("http://localhost:8000/api/v1/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            email,
            password,
            role,
            firm_code: firmCode,
          }),
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || "회원가입에 실패했습니다");
        }

        localStorage.setItem("access_token", data.access_token);
        localStorage.setItem("user_email", data.email);
        localStorage.setItem("user_id", data.user_id);
        await onLogin();
      }
    } catch (error) {
      console.error("요청 실패:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : mode === "login"
            ? "로그인 중 오류가 발생했습니다."
            : "회원가입 중 오류가 발생했습니다.";
      alert(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex relative overflow-hidden bg-background"
      style={{
        transition: 'opacity 0.5s cubic-bezier(0.4, 0, 0.6, 1), transform 0.5s cubic-bezier(0.4, 0, 0.6, 1)',
        opacity: exiting ? 0 : 1,
        transform: exiting ? 'translateY(-24px)' : 'translateY(0)',
      }}
    >
      {/* ═══ Left — Brand Visual ═══ */}
      <div
        className="hidden lg:flex relative overflow-hidden flex-col lg:w-[60%]"
        style={{
          background:
            "linear-gradient(160deg, #6D5EF5 0%, #8B7AF7 40%, #A78BFA 75%, #C4B5FD 100%)",
        }}
      >
        {/* Content */}
        <div className="relative z-[30] flex flex-col items-start h-full pl-24 pr-16" style={{ paddingTop: 'calc(50vh - 160px)' }}>
          {/* Tagline & Features */}
          <div className="space-y-10">
            <div>
              <h2 className="text-white text-[44px] font-bold tracking-tight leading-[1.2]">
                법률 업무의 새로운 기준
              </h2>
              <p className="text-white/80 mt-5 text-lg leading-relaxed">
                당신이 사건에 집중하는 동안,
                <br />
                AI 비서가 증거와 판례들을 정리합니다.
              </p>
            </div>

            <div className="space-y-4">
              {features.map((item) => (
                <div key={item.text} className="flex items-center gap-3.5">
                  <div className="p-2.5 rounded-lg bg-white/10">
                    <item.icon className="h-5 w-5 text-white/90" />
                  </div>
                  <span className="text-white/90 text-base">{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Copyright — pinned to bottom */}
          <p className="absolute bottom-6 left-24 text-white text-sm">
            © 2026 Casemate. All rights reserved.
          </p>
        </div>

      </div>

      {/* ═══ Right — Login / Signup Form ═══ */}
      <div className="w-full lg:w-[40%] flex items-center justify-center p-6 lg:p-12 bg-background relative overflow-hidden">
        <div className="relative z-[30] w-full max-w-[380px]">
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-10">
            <div
              className="p-2 rounded-xl"
              style={{
                background: "linear-gradient(135deg, #6D5EF5, #A78BFA)",
              }}
            >
              <Scale className="h-6 w-6 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-foreground">
              Casemate
            </span>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h1 className="text-[28px] font-semibold tracking-tight text-foreground">
              {mode === "login"
                ? "다시 오신 것을 환영합니다"
                : "새 계정 만들기"}
            </h1>
            <p className="text-muted-foreground/70 mt-2.5 text-[15px]">
              {mode === "login"
                ? "계속하려면 로그인하세요"
                : "Casemate와 함께 시작하세요"}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-sm font-medium">
                  이름
                </Label>
                <Input
                  id="name"
                  placeholder="홍길동"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isLoading}
                  className="h-11"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium">
                이메일
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="example@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium">
                비밀번호
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                className="h-11"
              />
            </div>
            {mode === "signup" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="role" className="text-sm font-medium">
                    직업
                  </Label>
                  <Select
                    value={role}
                    onValueChange={setRole}
                    disabled={isLoading}
                  >
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
                <div className="space-y-1.5">
                  <Label htmlFor="firm-code" className="text-sm font-medium">
                    회사 코드 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="firm-code"
                    placeholder="회사 코드를 입력하세요"
                    value={firmCode}
                    onChange={(e) => setFirmCode(e.target.value)}
                    disabled={isLoading}
                    className="h-11"
                    required
                  />
                </div>
              </>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 mt-1 flex items-center justify-center font-semibold rounded-lg text-white text-sm transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
              style={{
                background: "#7C6EF6",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#6D5EF5"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#7C6EF6"; }}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {mode === "login" ? "로그인 중..." : "가입 중..."}
                </>
              ) : mode === "login" ? (
                "로그인"
              ) : (
                "시작하기"
              )}
            </button>
          </form>

          {/* Mode toggle */}
          <div className="mt-6 text-center">
            {mode === "login" ? (
              <p className="text-sm text-muted-foreground">
                계정이 없으신가요?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  disabled={isLoading}
                  className="text-primary font-semibold hover:underline underline-offset-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                  disabled={isLoading}
                  className="text-primary font-semibold hover:underline underline-offset-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  로그인
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
      {/* ═══ Unified Waves — spans full width ═══ */}
      <div className="hidden lg:block absolute bottom-0 left-0 right-0 h-[320px] pointer-events-none" style={{ zIndex: 20 }}>
        {/* Left half — white filled waves (visible on purple bg) */}
        <div className="absolute inset-0" style={{ clipPath: "inset(0 40% 0 0)" }}>
          <div className="absolute bottom-0 left-0 h-[260px]" style={{ width: "200%", animation: "wave-drift 30s linear infinite" }}>
            <svg viewBox="0 0 2400 260" preserveAspectRatio="none" className="w-full h-full">
              <path d="M0,130 C200,60 400,200 600,120 C800,40 1000,190 1200,130 C1400,70 1600,200 1800,120 C2000,40 2200,180 2400,130 L2400,260 L0,260 Z" fill="rgba(255,255,255,0.06)" />
            </svg>
          </div>
          <div className="absolute bottom-0 left-0 h-[200px]" style={{ width: "200%", animation: "wave-drift 20s linear infinite" }}>
            <svg viewBox="0 0 2400 200" preserveAspectRatio="none" className="w-full h-full">
              <path d="M0,100 C300,35 500,165 800,90 C1100,15 1300,155 1600,100 C1900,45 2100,165 2400,100 L2400,200 L0,200 Z" fill="rgba(255,255,255,0.10)" />
            </svg>
          </div>
          <div className="absolute bottom-0 left-0 h-[140px]" style={{ width: "200%", animation: "wave-drift 15s linear infinite reverse" }}>
            <svg viewBox="0 0 2400 140" preserveAspectRatio="none" className="w-full h-full">
              <path d="M0,70 C200,25 450,115 700,60 C950,5 1150,105 1400,70 C1650,35 1900,115 2100,60 C2300,15 2400,70 2400,70 L2400,140 L0,140 Z" fill="rgba(255,255,255,0.16)" />
            </svg>
          </div>
        </div>

        {/* Right half — purple stroke waves (visible on light bg) */}
        <div className="absolute inset-0" style={{ clipPath: "inset(0 0 0 60%)" }}>
          <div className="absolute bottom-0 left-0 h-[260px]" style={{ width: "200%", animation: "wave-drift 30s linear infinite" }}>
            <svg viewBox="0 0 2400 260" preserveAspectRatio="none" className="w-full h-full">
              <path d="M0,130 C200,60 400,200 600,120 C800,40 1000,190 1200,130 C1400,70 1600,200 1800,120 C2000,40 2200,180 2400,130" fill="none" stroke="rgba(109,94,245,0.10)" strokeWidth="1.5" />
            </svg>
          </div>
          <div className="absolute bottom-0 left-0 h-[200px]" style={{ width: "200%", animation: "wave-drift 20s linear infinite" }}>
            <svg viewBox="0 0 2400 200" preserveAspectRatio="none" className="w-full h-full">
              <path d="M0,100 C300,35 500,165 800,90 C1100,15 1300,155 1600,100 C1900,45 2100,165 2400,100" fill="none" stroke="rgba(109,94,245,0.12)" strokeWidth="1.5" />
            </svg>
          </div>
          <div className="absolute bottom-0 left-0 h-[140px]" style={{ width: "200%", animation: "wave-drift 15s linear infinite reverse" }}>
            <svg viewBox="0 0 2400 140" preserveAspectRatio="none" className="w-full h-full">
              <path d="M0,70 C200,25 450,115 700,60 C950,5 1150,105 1400,70 C1650,35 1900,115 2100,60 C2300,15 2400,70 2400,70" fill="none" stroke="rgba(109,94,245,0.14)" strokeWidth="1.5" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
