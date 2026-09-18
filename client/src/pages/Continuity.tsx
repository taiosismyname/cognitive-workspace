import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { AlertCircle, Archive, BrainCircuit, CheckCircle2, FileText, GitBranch, History, Link2, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString();
}

function parseSummary(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function StatusPill({ status, good = false }: { status: string; good?: boolean }) {
  return <Badge className={good ? "bg-[#e6f1e8] text-[#477458]" : "bg-[#f5ead7] text-[#956c32]"}>{status}</Badge>;
}

export default function Continuity() { return <DashboardLayout><ContinuityContent /></DashboardLayout>; }

function ContinuityContent() {
  const continuity = trpc.continuity.overview.useQuery();
  const workspace = trpc.workspace.overview.useQuery();
  const [selectedModelId, setSelectedModelId] = useState<number | undefined>();
  const connections = continuity.data?.connections ?? [];
  const imports = continuity.data?.imports ?? [];
  const snapshots = continuity.data?.snapshots ?? [];
  const importedConversations = continuity.data?.importedConversations ?? [];
  const models = workspace.data?.models ?? [];
  const conversations = workspace.data?.conversations ?? [];
  const memories = workspace.data?.memories ?? [];
  const currentSnapshots = snapshots.filter(snapshot => snapshot.isCurrent || snapshot.status === "published");
  const selectedModel = models.find(model => model.id === selectedModelId) ?? models.find(model => currentSnapshots.some(snapshot => snapshot.modelRegistryId === model.id)) ?? models[0];
  const laneSnapshots = selectedModel ? snapshots.filter(snapshot => snapshot.modelRegistryId === selectedModel.id) : [];
  const current = laneSnapshots.find(snapshot => snapshot.isCurrent && snapshot.status === "published") ?? laneSnapshots.find(snapshot => snapshot.status === "published") ?? laneSnapshots[0];
  const currentModel = selectedModel;
  const snapshotDetail = trpc.continuity.snapshot.useQuery({ id: current?.id ?? 0 }, { enabled: Boolean(current) });
  const summary = parseSummary(current?.stateSummaryJson);
  const sourceById = new Map(conversations.map(conversation => [conversation.id, conversation]));
  const artifactSources = snapshotDetail.data?.sources ?? [];
  const artifactSourceCount = new Map<number, number>();
  artifactSources.forEach(source => artifactSourceCount.set(source.artifactId, (artifactSourceCount.get(source.artifactId) ?? 0) + 1));
  const artifacts = snapshotDetail.data?.artifacts ?? [];
  const reconstructableEvidence = current ? {
    snapshot: { id: current.id, modelRegistryId: current.modelRegistryId, version: current.version, status: current.status, stateSchemaVersion: current.stateSchemaVersion, stateSummaryJson: current.stateSummaryJson, stateHash: current.stateHash },
    artifacts: artifacts.map(artifact => ({ ...artifact, sources: artifactSources.filter(source => source.artifactId === artifact.id) })),
  } : null;

  if (continuity.isLoading || workspace.isLoading) {
    return <div className="mx-auto max-w-[1500px] px-5 py-10 md:px-10"><div className="grid min-h-[420px] place-items-center rounded-3xl border border-black/5 bg-white text-sm text-muted-foreground"><Sparkles className="mr-2 size-4 animate-pulse" /> Loading continuity state…</div></div>;
  }

  if (continuity.error || workspace.error) {
    return <div className="mx-auto max-w-[1500px] px-5 py-10 md:px-10"><Card className="border-0 bg-white shadow-sm"><CardContent className="flex items-start gap-3 p-6 text-sm text-red-700"><AlertCircle className="mt-0.5 size-4 shrink-0" /><div><p className="font-medium">Continuity data could not be loaded.</p><p className="mt-1 text-red-600/80">{continuity.error?.message ?? workspace.error?.message ?? "The continuity service returned no data."}</p></div></CardContent></Card></div>;
  }

  return <div className="mx-auto max-w-[1500px] px-5 py-8 md:px-10 md:py-10">
    <header className="mb-9 flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div>
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#789381]"><span className="size-2 rounded-full bg-[#72a77d]" /> External model continuity</div>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-[#16211f] md:text-5xl">See what a model can actually carry forward.</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-[#6d7772]">This is a read-only view of the continuity machinery: provider connections, imported source history, versioned external state, derived memories, and the evidence available for future reconstruction.</p>
      </div>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center"><label className="flex items-center gap-2 rounded-2xl border border-black/5 bg-white px-3 py-2 text-xs shadow-sm"><span className="font-medium text-muted-foreground">Model lane</span><select value={selectedModel?.id ?? ""} onChange={event => setSelectedModelId(event.target.value ? Number(event.target.value) : undefined)} className="max-w-48 bg-transparent font-medium outline-none" aria-label="Select model continuity lane"><option value="">No model selected</option>{models.map(model => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select></label><div className="flex items-center gap-2 rounded-2xl border border-black/5 bg-white px-3 py-2 text-xs shadow-sm"><ShieldCheck className="size-4 text-[#679576]" /><span className="font-medium">No source history is overwritten</span></div></div>
    </header>

    <section className="grid gap-4 md:grid-cols-4">
      <Metric icon={BrainCircuit} label="Model lanes" value={models.length} detail={`${currentSnapshots.length} current state records`} />
      <Metric icon={Link2} label="Provider connections" value={connections.length} detail="Authorized or pending" />
      <Metric icon={Archive} label="History imports" value={imports.length} detail="Source-preserving jobs" />
      <Metric icon={History} label="State versions" value={snapshots.length} detail="Never silently overwritten" />
    </section>

    <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <Card className="border-0 bg-[#16211f] text-white shadow-[0_20px_60px_rgba(21,39,33,0.14)]"><CardContent className="p-8 md:p-10"><Badge className="border-0 bg-[#d8f0df]/15 text-[#d8f0df]">Reconstructable context</Badge><h2 className="mt-6 text-2xl font-semibold tracking-[-0.03em]">What can be supplied to a model right now?</h2><p className="mt-4 max-w-2xl text-sm leading-7 text-white/65">Only state that is already published or marked current can be treated as continuity context. The panel below is intentionally honest: if no published snapshot exists, the UI does not invent one.</p><div className="mt-7 rounded-2xl border border-white/10 bg-white/5 p-5"><div className="flex items-center justify-between gap-4"><span className="text-xs uppercase tracking-[0.18em] text-white/45">Current lane</span>{current ? <StatusPill status={current.status} good={current.status === "published"} /> : <StatusPill status="No published state" />}</div><p className="mt-3 text-lg font-medium">{currentModel?.displayName ?? "No model state selected"}</p><p className="mt-1 text-xs text-white/50">{currentModel ? `${currentModel.providerKey} · ${currentModel.modelKey}` : "A reconstruction snapshot is required before continuity can be supplied."}</p>{summary && <div className="mt-5 space-y-2 text-sm text-white/75">{Object.entries(summary).slice(0, 5).map(([key, value]) => <div key={key} className="flex gap-3 border-t border-white/10 pt-2"><span className="min-w-28 text-white/40">{key}</span><span className="line-clamp-3">{typeof value === "string" ? value : JSON.stringify(value)}</span></div>)}</div>}{!summary && <p className="mt-5 text-sm text-white/55">No state summary is stored in the current snapshot. Imported sources and derived memories remain inspectable below, but no reconstructed context is claimed.</p>}{reconstructableEvidence && <details className="mt-5 rounded-xl border border-white/10 bg-black/10 p-4"><summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-white/60">Exact persisted evidence payload</summary><pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-white/70">{JSON.stringify(reconstructableEvidence, null, 2)}</pre></details>}</div></CardContent></Card>
      <Card className="border-0 bg-white shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><GitBranch className="size-4 text-[#679576]" /> Current state lineage</CardTitle></CardHeader><CardContent className="space-y-4 text-sm"><Line label="Published/current snapshots" value={currentSnapshots.length.toString()} /><Line label="Latest version" value={current?.version ? `v${current.version}` : "None"} /><Line label="State schema" value={current?.stateSchemaVersion ?? "Not available"} /><Line label="Created" value={formatDate(current?.createdAt)} /><Line label="Hash" value={current?.stateHash ? `${current.stateHash.slice(0, 18)}…` : "Not available"} /></CardContent></Card>
    </div>

    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <Card className="border-0 bg-white shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Link2 className="size-4 text-[#679576]" /> Provider connections</CardTitle></CardHeader><CardContent className="space-y-3">{connections.length ? connections.map(connection => <div key={connection.id} className="rounded-xl border border-black/5 bg-[#fafbf8] p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-medium">{connection.displayLabel ?? connection.providerKey}</p><p className="mt-1 text-xs text-muted-foreground">{connection.providerKey} · connection #{connection.id}</p></div><StatusPill status={connection.status} good={connection.status === "active"} /></div></div>) : <Empty icon={Link2} text="No provider connections have been recorded yet." />}</CardContent></Card>
      <Card className="border-0 bg-white shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Archive className="size-4 text-[#679576]" /> Imported source history</CardTitle></CardHeader><CardContent className="space-y-5"><div><p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#789381]">Import jobs</p><div className="space-y-3">{imports.length ? imports.map(item => <div key={item.id} className="rounded-xl border border-black/5 bg-[#fafbf8] p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-medium">{item.sourceFileName ?? `Import #${item.id}`}</p><p className="mt-1 text-xs text-muted-foreground">{item.conversationsImported} conversations · {item.messagesImported} messages · {formatDate(item.createdAt)}</p></div><StatusPill status={item.status} good={item.status === "completed"} /></div><p className="mt-2 text-xs text-muted-foreground">Connection #{item.providerConnectionId} · {item.duplicatesSkipped} duplicates skipped</p></div>) : <Empty icon={Archive} text="No provider-sourced history has been imported yet." />}</div></div><Separator /><div><p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#789381]">Imported conversations</p><div className="space-y-3">{importedConversations.length ? importedConversations.slice(0, 12).map(item => <div key={item.conversation.id} className="rounded-xl border border-black/5 bg-[#fafbf8] p-4"><p className="font-medium">{item.conversation.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.origin.providerKey ?? "provider import"} · native conversation {item.origin.nativeConversationId ?? "unidentified"}</p><p className="mt-2 text-xs text-muted-foreground">Imported {formatDate(item.origin.nativeCreatedAt)} · import #{item.origin.historyImportId ?? "—"}</p></div>) : <Empty icon={FileText} text="No imported conversation records are available yet." />}</div></div></CardContent></Card>
    </div>

    <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <Card className="border-0 bg-white shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><History className="size-4 text-[#679576]" /> State/version history</CardTitle></CardHeader><CardContent className="space-y-3">{snapshots.length ? snapshots.map(snapshot => { const model = models.find(item => item.id === snapshot.modelRegistryId); return <div key={snapshot.id} className="rounded-xl border border-black/5 bg-[#fafbf8] p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-medium">{model?.displayName ?? `Model #${snapshot.modelRegistryId}`} · v{snapshot.version}</p><p className="mt-1 text-xs text-muted-foreground">{snapshot.stateSchemaVersion} · {formatDate(snapshot.createdAt)}</p></div><StatusPill status={snapshot.status} good={snapshot.status === "published"} /></div><p className="mt-2 text-xs text-muted-foreground">{snapshot.parentSnapshotId ? `Parent snapshot #${snapshot.parentSnapshotId}` : "Root snapshot"} · {snapshot.isCurrent ? "current" : "historical"}</p></div>; }) : <Empty icon={History} text="No model-specific state snapshots exist yet." />}</CardContent></Card>
      <Card className="border-0 bg-white shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileText className="size-4 text-[#679576]" /> Derived state and provenance</CardTitle></CardHeader><CardContent className="space-y-5"><div><p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#789381]">State artifacts for selected lane</p><div className="space-y-3">{artifacts.length ? artifacts.slice(0, 12).map(artifact => { const artifactSummary = parseSummary(artifact.contentJson); return <div key={artifact.id} className="rounded-xl border border-black/5 bg-[#fafbf8] p-4"><div className="flex items-center justify-between gap-3"><p className="font-medium">{artifact.artifactType}</p><StatusPill status={`${artifactSourceCount.get(artifact.id) ?? 0} sources`} good={Boolean(artifactSourceCount.get(artifact.id))} /></div><p className="mt-2 line-clamp-3 text-sm leading-6">{artifactSummary ? JSON.stringify(artifactSummary) : artifact.contentJson}</p><p className="mt-2 text-xs text-muted-foreground">Confidence {artifact.confidence ?? "not recorded"} · {artifact.status}</p>{artifactSources.filter(source => source.artifactId === artifact.id).map(source => <div key={`${artifact.id}-${source.conversationId}-${source.messageId ?? "none"}`} className="mt-3 rounded-lg bg-white p-3 text-xs text-muted-foreground"><p className="font-medium text-[#16211f]">Source conversation #{source.conversationId} · message {source.messageId ?? "not recorded"}</p><p className="mt-1">{source.sourceRole} · relevance {source.relevance ?? "not recorded"}</p>{source.quoteJson && <p className="mt-1 line-clamp-3">Quote: {source.quoteJson}</p>}</div>)}</div>; }) : <Empty icon={GitBranch} text="No state artifacts exist for the selected lane." />}</div></div><Separator /><div><p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#789381]">Derived memories</p><div className="space-y-3">{memories.length ? memories.slice(0, 12).map(memory => <div key={memory.id} className="rounded-xl border border-black/5 bg-[#fafbf8] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm leading-6">{memory.content}</p><p className="mt-2 text-xs text-muted-foreground">Model #{memory.modelRegistryId} · {memory.embeddingModel ?? "embedding unavailable"}</p></div><StatusPill status={memory.isRetrievalEligible ? "eligible" : "excluded"} good={memory.isRetrievalEligible} /></div><Separator className="my-3" /><p className="flex items-center gap-2 text-xs text-muted-foreground"><Link2 className="size-3" /> Source: {sourceById.get(memory.sourceConversationId)?.title ?? `Conversation #${memory.sourceConversationId}`} · message #{memory.sourceMessageId}</p></div>) : <Empty icon={FileText} text="No derived memories have been created yet." />}</div></div></CardContent></Card>
    </div>

    <p className="mt-7 text-xs leading-5 text-muted-foreground">This surface reports only persisted data returned by the existing APIs. It does not imply that a provider-native history connection or model reconstruction exists when the underlying records are absent.</p>
  </div>;
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof BrainCircuit; label: string; value: number; detail: string }) { return <Card className="border-0 bg-white shadow-[0_12px_40px_rgba(27,47,39,0.06)]"><CardContent className="p-5"><div className="mb-5 flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">{label}</span><span className="grid size-9 place-items-center rounded-xl bg-[#edf4ee] text-[#5d876b]"><Icon className="size-4" /></span></div><div className="text-3xl font-semibold tracking-tight text-[#16211f]">{value}</div><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>; }
function Line({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-4 border-b border-black/5 pb-3 last:border-0 last:pb-0"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium text-[#16211f]">{value}</span></div>; }
function Empty({ icon: Icon, text }: { icon: typeof BrainCircuit; text: string }) { return <div className="grid min-h-24 place-items-center rounded-2xl border border-dashed border-[#c9d5cb] bg-[#fafbf8] p-5 text-center text-xs text-muted-foreground"><div><Icon className="mx-auto mb-2 size-5 text-[#8a9d90]" /><p>{text}</p></div></div>; }
