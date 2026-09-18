import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { startLogin } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { BrainCircuit, Database, FileText, GitBranch, LayoutDashboard, LogOut, PanelLeft, Scale } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";

const menuItems = [
  { icon: LayoutDashboard, label: "Workspace", path: "/" },
  { icon: BrainCircuit, label: "Model registry", path: "/models" },
  { icon: FileText, label: "Conversations", path: "/conversations" },
  { icon: Database, label: "Memory ledger", path: "/memories" },
  { icon: Scale, label: "Council runs", path: "/councils" },
  { icon: GitBranch, label: "Continuity", path: "/continuity" },
];
const SIDEBAR_WIDTH_KEY = "sidebar-width";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)) || 280);
  const { loading, user } = useAuth();
  useEffect(() => localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString()), [sidebarWidth]);
  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) return <div className="min-h-screen grid place-items-center bg-[#f6f5f2]"><div className="w-full max-w-md rounded-3xl border border-black/5 bg-white p-10 text-center shadow-xl shadow-black/5"><div className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl bg-[#16211f] text-[#d8f0df]"><BrainCircuit className="size-7" /></div><h1 className="text-2xl font-semibold tracking-tight">Your thinking, organized.</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Sign in to work across models, preserve source context, and keep every memory traceable.</p><Button onClick={() => startLogin()} size="lg" className="mt-8 w-full rounded-xl bg-[#16211f] hover:bg-[#263a35]">Enter workspace</Button></div></div>;
  return <SidebarProvider style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}><DashboardLayoutContent setSidebarWidth={setSidebarWidth}>{children}</DashboardLayoutContent></SidebarProvider>;
}

function DashboardLayoutContent({ children, setSidebarWidth }: { children: React.ReactNode; setSidebarWidth: (width: number) => void }) {
  const { user, logout } = useAuth();
  if (!user) return null;
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const activeMenuItem = menuItems.find(item => item.path === location);
  useEffect(() => {
    const move = (event: MouseEvent) => { if (isResizing) setSidebarWidth(Math.min(420, Math.max(220, event.clientX - (sidebarRef.current?.getBoundingClientRect().left ?? 0)))); };
    const up = () => setIsResizing(false);
    if (isResizing) { document.addEventListener("mousemove", move); document.addEventListener("mouseup", up); document.body.style.cursor = "col-resize"; }
    return () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.body.style.cursor = ""; };
  }, [isResizing, setSidebarWidth]);
  return <><div ref={sidebarRef} className="relative"><Sidebar collapsible="icon" className="border-r border-black/5 bg-[#f1f2ed]"><SidebarHeader className="h-20 justify-center"><div className="flex w-full items-center gap-3 px-2"><button onClick={toggleSidebar} className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#16211f] text-[#d8f0df] transition-transform active:scale-95" aria-label="Toggle navigation"><PanelLeft className="size-4" /></button>{!isCollapsed && <div className="min-w-0"><p className="truncate text-sm font-semibold tracking-tight">Cognitive Workspace</p><p className="truncate text-[11px] text-muted-foreground">private model lab</p></div>}</div></SidebarHeader><SidebarContent><SidebarMenu className="gap-1 px-2 py-3">{menuItems.map(item => <SidebarMenuItem key={item.path}><SidebarMenuButton isActive={location === item.path} onClick={() => setLocation(item.path)} tooltip={item.label} className="h-11 rounded-xl font-medium"><item.icon className="size-4" /><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarContent><SidebarFooter className="p-3"><DropdownMenu><DropdownMenuTrigger asChild><button className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-white/70"><Avatar className="size-9 border border-black/5"><AvatarFallback>{user.name?.charAt(0).toUpperCase() ?? "U"}</AvatarFallback></Avatar><div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden"><p className="truncate text-sm font-medium">{user.name ?? "Workspace member"}</p><p className="truncate text-xs text-muted-foreground">{user.email ?? "Authenticated"}</p></div></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48"><DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive"><LogOut className="mr-2 size-4" /> Sign out</DropdownMenuItem></DropdownMenuContent></DropdownMenu></SidebarFooter></Sidebar><div className={`absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[#8ab89a]/40 ${isCollapsed ? "hidden" : ""}`} onMouseDown={() => setIsResizing(true)} /></div><SidebarInset className="bg-[#f6f5f2]">{isMobile && <div className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-black/5 bg-[#f6f5f2]/90 px-3 backdrop-blur"><SidebarTrigger className="size-9 rounded-xl bg-white" /><span className="text-sm font-semibold">{activeMenuItem?.label ?? "Workspace"}</span></div>}<main className="min-h-screen">{children}</main></SidebarInset></>;
}
