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
import { Scale, FileText, Search, BarChart3, Loader2 } from "lucide-react";

interface AuthPageProps {
  onLogin: () => void;
}

export function AuthPage({ onLogin }: AuthPageProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [firmCode, setFirmCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 회원가입 시 회사 코드 필수 검증
    if (mode === "signup" && !firmCode.trim()) {
      alert('회사 코드를 입력해주세요.');
      return;
    }

    setIsLoading(true);

    try {
      if (mode === "login") {
        // 로그인 API 호출
        const response = await fetch('http://localhost:8000/api/v1/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, password }),
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || '로그인에 실패했습니다');
        }

        console.log('로그인 결과:', data);

        // JWT 토큰 저장
        localStorage.setItem('access_token', data.access_token);
        // 로그인 처리
        onLogin();
      } else {
        // 회원가입 API 호출 (회사 코드 포함)
        const response = await fetch('http://localhost:8000/api/v1/signup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name, email, password, role, firm_code: firmCode }),
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || '회원가입에 실패했습니다');
        }

        console.log('회원가입 결과:', data);

        // JWT 토큰 저장 (자동 로그인)
        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('user_email', data.email);
        localStorage.setItem('user_id', data.user_id);
        // 자동 로그인 처리 - 바로 화면 이동
        onLogin();
      }
    } catch (error) {
      console.error('요청 실패:', error);
      // Error 객체의 message를 사용하여 백엔드에서 받은 에러 메시지 표시
      const errorMessage = error instanceof Error ? error.message :
        (mode === "login" ? '로그인 중 오류가 발생했습니다.' : '회원가입 중 오류가 발생했습니다.');
      alert(errorMessage);
    } finally {
      setIsLoading(false);
    }
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
                  disabled={isLoading}
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
                disabled={isLoading}
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
                disabled={isLoading}
                className="h-11"
              />
            </div>
            {mode === "signup" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="role" className="text-sm font-medium">
                    직업
                  </Label>
                  <Select value={role} onValueChange={setRole} disabled={isLoading}>
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
                <div className="space-y-2">
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
            <Button
              type="submit"
              className="w-full h-11 mt-2 font-medium"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {mode === "login" ? "로그인 중..." : "회원가입 중..."}
                </>
              ) : (
                mode === "login" ? "로그인" : "회원가입"
              )}
            </Button>
          </form>

          <div className="mt-8 text-center">
            {mode === "login" ? (
              <p className="text-sm text-muted-foreground">
                계정이 없으신가요?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  disabled={isLoading}
                  className="text-foreground font-medium hover:underline underline-offset-4 disabled:opacity-50 disabled:cursor-not-allowed"
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
                  className="text-foreground font-medium hover:underline underline-offset-4 disabled:opacity-50 disabled:cursor-not-allowed"
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
