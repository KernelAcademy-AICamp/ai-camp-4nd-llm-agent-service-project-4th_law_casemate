export function Footer() {
  return (
    <footer className="flex h-10 shrink-0 items-center justify-between border-t border-border bg-background px-4 text-xs text-muted-foreground">
      <span>© 2026 LegalOS Inc. All rights reserved.</span>
      <div className="flex items-center gap-4">
        <a href="#" className="hover:text-foreground hover:underline">
          이용약관
        </a>
        <a href="#" className="hover:text-foreground hover:underline">
          개인정보처리방침
        </a>
      </div>
    </footer>
  )
}
