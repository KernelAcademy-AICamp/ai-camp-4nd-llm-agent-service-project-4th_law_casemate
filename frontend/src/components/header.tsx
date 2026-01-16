import { ChevronDown, Apple, PlayIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

export function Header() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4">
      {/* Left: Logo */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <span className="text-sm font-bold text-primary-foreground">L</span>
        </div>
        <span className="text-lg font-semibold text-foreground">LeaseLab</span>
        <span className="text-xs text-muted-foreground">by LegalOS Inc.</span>
      </div>

      {/* Right: App downloads + User menu */}
      <div className="flex items-center gap-4">
        {/* App download links - subtle */}
        <div className="hidden items-center gap-2 md:flex">
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Apple className="h-3.5 w-3.5" />
            iOS
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground">
            <PlayIcon className="h-3.5 w-3.5" />
            Android
          </Button>
        </div>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 bg-transparent">
              <Avatar className="h-6 w-6">
                <AvatarFallback className="bg-primary/10 text-xs text-primary">김</AvatarFallback>
              </Avatar>
              <span className="text-sm">김변호사</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem>프로필</DropdownMenuItem>
            <DropdownMenuItem>구독 관리</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive">로그아웃</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
