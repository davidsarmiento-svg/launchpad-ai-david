"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type HelloResponse = { message: string };

export function HelloButton() {
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/hello");
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const data = (await res.json()) as HelloResponse;
      setMessage(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={handleClick} disabled={loading} size="lg">
        {loading ? "Calling…" : "Say hi"}
      </Button>
      {message && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          API responded:{" "}
          <span className="font-mono text-zinc-950 dark:text-zinc-50">
            {message}
          </span>
        </p>
      )}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Error: <span className="font-mono">{error}</span>
        </p>
      )}
    </div>
  );
}
