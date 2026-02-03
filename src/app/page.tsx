"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch("/api/admin/vault/status");
        const data = await res.json();

        if (!data.initialized) {
          router.replace("/setup");
        } else {
          router.replace("/vault");
        }
      } catch {
        // If there's an error, default to setup
        router.replace("/setup");
      }
    }

    checkStatus();
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}
