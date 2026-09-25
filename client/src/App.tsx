import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Continuity from "./pages/Continuity";
import Login from "./pages/Login";

function Router() {
  return <Switch><Route path="/login" component={Login} /><Route path="/" component={Home} /><Route path="/models" component={Home} /><Route path="/conversations" component={Home} /><Route path="/memories" component={Home} /><Route path="/councils" component={Home} /><Route path="/continuity" component={Continuity} /><Route path="/integrations" component={Home} /><Route path="/404" component={NotFound} /><Route component={NotFound} /></Switch>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
