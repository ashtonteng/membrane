"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Agent {
  id: string;
  name: string;
  api_key_prefix: string;
  created_at: string;
}

interface Folder {
  id: string;
  name: string;
  file_count: number;
  created_at: string;
}

interface Grant {
  id: string;
  agent_id: string;
  folder_id: string;
  agent_name: string;
  folder_name: string;
  granted_at: string;
}

export default function PermissionsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [agentsRes, foldersRes, grantsRes] = await Promise.all([
        fetch("/api/admin/agents"),
        fetch("/api/admin/folders"),
        fetch("/api/admin/grants"),
      ]);

      if (!agentsRes.ok || !foldersRes.ok || !grantsRes.ok) {
        throw new Error("Failed to fetch data");
      }

      const [agentsData, foldersData, grantsData] = await Promise.all([
        agentsRes.json(),
        foldersRes.json(),
        grantsRes.json(),
      ]);

      setAgents(agentsData.agents);
      setFolders(foldersData.folders);
      setGrants(grantsData.grants);

      // Auto-select first agent if none selected
      if (!selectedAgent && agentsData.agents.length > 0) {
        setSelectedAgent(agentsData.agents[0]);
      }
    } catch (error) {
      toast.error("Failed to load data");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [selectedAgent]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const hasAccess = (agentId: string, folderId: string) => {
    return grants.some(
      (grant) => grant.agent_id === agentId && grant.folder_id === folderId
    );
  };

  const getGrantId = (agentId: string, folderId: string) => {
    const grant = grants.find(
      (g) => g.agent_id === agentId && g.folder_id === folderId
    );
    return grant?.id;
  };

  const handleToggleAccess = async (folderId: string, currentlyHasAccess: boolean) => {
    if (!selectedAgent) return;

    const key = `${selectedAgent.id}-${folderId}`;
    setUpdating(key);

    try {
      if (currentlyHasAccess) {
        // Revoke access
        const grantId = getGrantId(selectedAgent.id, folderId);
        if (!grantId) throw new Error("Grant not found");

        const res = await fetch(`/api/admin/grants/${grantId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to revoke access");

        setGrants(grants.filter((g) => g.id !== grantId));
        toast.success("Access revoked");
      } else {
        // Grant access
        const res = await fetch("/api/admin/grants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: selectedAgent.id,
            folderId: folderId,
          }),
        });
        if (!res.ok) throw new Error("Failed to grant access");

        const newGrant = await res.json();
        // Fetch folder name for the new grant
        const folder = folders.find((f) => f.id === folderId);
        setGrants([
          ...grants,
          {
            ...newGrant,
            agent_name: selectedAgent.name,
            folder_name: folder?.name || "Unknown",
          },
        ]);
        toast.success("Access granted");
      }
    } catch (error) {
      toast.error(
        currentlyHasAccess ? "Failed to revoke access" : "Failed to grant access"
      );
      console.error(error);
    } finally {
      setUpdating(null);
    }
  };

  const getAgentGrantCount = (agentId: string) => {
    return grants.filter((g) => g.agent_id === agentId).length;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Permissions</h1>
        <p className="text-muted-foreground">
          Control which agents can access your folders
        </p>
      </div>

      {agents.length === 0 || folders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6 text-muted-foreground"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
              </svg>
            </div>
            <p className="mb-2 text-sm font-medium">
              {agents.length === 0
                ? "No agents registered"
                : "No folders created"}
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              {agents.length === 0
                ? "Register an agent first to manage permissions"
                : "Create a folder first to share with agents"}
            </p>
            <Link href={agents.length === 0 ? "/agents" : "/vault"}>
              <Button>
                {agents.length === 0 ? "Register Agent" : "Create Folder"}
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Agents list */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-lg">Agents</CardTitle>
              <CardDescription>Select an agent to manage access</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {agents.map((agent) => {
                  const grantCount = getAgentGrantCount(agent.id);
                  const isSelected = selectedAgent?.id === agent.id;

                  return (
                    <button
                      key={agent.id}
                      onClick={() => setSelectedAgent(agent)}
                      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted"
                      }`}
                    >
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full ${
                          isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                        }`}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-5 w-5"
                        >
                          <path d="M12 8V4H8" />
                          <rect width="16" height="12" x="4" y="8" rx="2" />
                          <path d="M2 14h2" />
                          <path d="M20 14h2" />
                          <path d="M15 13v2" />
                          <path d="M9 13v2" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{agent.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {grantCount} folder{grantCount !== 1 ? "s" : ""} shared
                        </p>
                      </div>
                      {grantCount > 0 && (
                        <Badge variant="secondary">{grantCount}</Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Folder access */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">
                {selectedAgent
                  ? `Folder Access for ${selectedAgent.name}`
                  : "Select an Agent"}
              </CardTitle>
              <CardDescription>
                {selectedAgent
                  ? "Toggle switches to grant or revoke folder access"
                  : "Choose an agent from the list to manage its folder access"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedAgent ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-6 w-6 text-muted-foreground"
                    >
                      <path d="m9 9 5 12 1.8-5.2L21 14Z" />
                      <path d="M7.2 2.2 8 5.1" />
                      <path d="m5.1 8-2.9-.8" />
                      <path d="M14 4.1 12 6" />
                      <path d="m6 12-1.9 2" />
                    </svg>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Select an agent to manage its folder access
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {folders.map((folder) => {
                    const access = hasAccess(selectedAgent.id, folder.id);
                    const isUpdating = updating === `${selectedAgent.id}-${folder.id}`;

                    return (
                      <div
                        key={folder.id}
                        className={`flex items-center justify-between rounded-lg border p-4 transition-colors ${
                          access ? "border-primary/30 bg-primary/5" : ""
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                              access ? "bg-primary/10" : "bg-muted"
                            }`}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className={`h-5 w-5 ${
                                access ? "text-primary" : "text-muted-foreground"
                              }`}
                            >
                              <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                            </svg>
                          </div>
                          <div>
                            <p className="font-medium">{folder.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {folder.file_count} file{folder.file_count !== 1 ? "s" : ""} | Created{" "}
                              {formatDate(folder.created_at)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {access && (
                            <Badge variant="secondary" className="text-xs">
                              Has Access
                            </Badge>
                          )}
                          <Switch
                            checked={access}
                            disabled={isUpdating}
                            onCheckedChange={() => handleToggleAccess(folder.id, access)}
                          />
                        </div>
                      </div>
                    );
                  })}

                  {folders.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        No folders available. Create folders in the Vault to share
                        them with agents.
                      </p>
                      <Link href="/vault" className="mt-4">
                        <Button variant="outline" size="sm">
                          Go to Vault
                        </Button>
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Info card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">How Permissions Work</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-muted p-4">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <span className="text-sm font-bold text-primary">1</span>
              </div>
              <p className="text-sm font-medium">You Control Access</p>
              <p className="text-xs text-muted-foreground">
                Agents never request access. You decide what to share proactively.
              </p>
            </div>
            <div className="rounded-lg bg-muted p-4">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <span className="text-sm font-bold text-primary">2</span>
              </div>
              <p className="text-sm font-medium">Folder-Level Grants</p>
              <p className="text-xs text-muted-foreground">
                Grant access to entire folders. All files in a folder become readable.
              </p>
            </div>
            <div className="rounded-lg bg-muted p-4">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <span className="text-sm font-bold text-primary">3</span>
              </div>
              <p className="text-sm font-medium">Instant Revocation</p>
              <p className="text-xs text-muted-foreground">
                Toggle off to revoke access immediately. The agent loses access instantly.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
