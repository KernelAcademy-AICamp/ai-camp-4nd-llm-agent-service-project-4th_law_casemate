import { Sidebar } from "@/components/sidebar"
import { ContractPanel } from "@/components/contract-panel"
import { IssuesPanel } from "@/components/issues-panel"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"

export function DashboardLayout() {
  return (
    <div className="flex h-screen flex-col bg-muted/30">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 overflow-hidden">
          <ContractPanel />
          <IssuesPanel />
        </main>
      </div>
      <Footer />
    </div>
  )
}
