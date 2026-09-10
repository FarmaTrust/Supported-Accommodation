import { trpc } from "@/lib/trpc";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

type EntitySummary = NonNullable<ReturnType<typeof useWorkspace>["entities"]>[number];

type WorkspaceValue = {
  entities: Array<{ id: number; name: string; legalName: string; supportContactName?: string | null; supportEmail?: string | null; supportPhone?: string | null; supportGuidance?: string | null }>;
  entityId: number | null;
  entity: EntitySummary | null;
  setEntityId: (id: number) => void;
  loading: boolean;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);
const KEY = "supported-accommodation-entity";

export function parseWorkspaceEntityId(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function initialWorkspaceEntityId(storageValue: string | null, search: string) {
  const requested = parseWorkspaceEntityId(new URLSearchParams(search).get("entity"));
  return requested ?? parseWorkspaceEntityId(storageValue);
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { data = [], isLoading } = trpc.entities.list.useQuery();
  const [entityId, setEntityIdState] = useState<number | null>(() => {
    return initialWorkspaceEntityId(window.localStorage.getItem(KEY), window.location.search);
  });

  useEffect(() => {
    const requested = parseWorkspaceEntityId(new URLSearchParams(window.location.search).get("entity"));
    if (requested) {
      if (requested !== entityId) setEntityIdState(requested);
      return;
    }
    if (!data.length) {
      setEntityIdState(null);
      return;
    }
    if (!entityId || !data.some(entity => entity.id === entityId)) {
      setEntityIdState(data[0].id);
    }
  }, [data, entityId]);

  useEffect(() => {
    const requested = parseWorkspaceEntityId(new URLSearchParams(window.location.search).get("entity"));
    if (requested && data.some(entity => entity.id === requested) && requested !== entityId) {
      setEntityIdState(requested);
    }
  }, [data, entityId]);

  const setEntityId = (id: number) => {
    window.localStorage.setItem(KEY, String(id));
    setEntityIdState(id);
  };

  const value = useMemo<WorkspaceValue>(() => ({
    entities: data,
    entityId,
    entity: data.find(item => item.id === entityId) ?? null,
    setEntityId,
    loading: isLoading,
  }), [data, entityId, isLoading]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return context;
}
