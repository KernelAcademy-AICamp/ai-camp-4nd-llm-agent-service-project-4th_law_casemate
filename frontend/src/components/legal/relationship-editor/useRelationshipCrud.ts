import { useCallback } from "react";
import { apiFetch } from "@/lib/api";
import type { PersonRole, PersonNode, RelationshipEdge } from "./types";

export function useRelationshipCrud(caseId: string) {

  const addPerson = useCallback(
    async (name: string, role: PersonRole, positionX: number, positionY: number): Promise<PersonNode> => {
      const response = await apiFetch(`/api/v1/relationships/${caseId}/persons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          role,
          description: "",
          position_x: Math.round(positionX),
          position_y: Math.round(positionY),
        }),
      });
      if (!response.ok) throw new Error("인물 추가에 실패했습니다");
      const created = await response.json();
      return {
        id: String(created.id),
        name: created.name,
        role: created.role as PersonRole,
        x: created.position_x,
        y: created.position_y,
      };
    },
    [caseId],
  );

  const updatePerson = useCallback(
    async (personId: string, name: string, role: PersonRole): Promise<void> => {
      const response = await apiFetch(`/api/v1/relationships/${caseId}/persons/${personId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, role, description: "" }),
      });
      if (!response.ok) throw new Error("인물 수정에 실패했습니다");
    },
    [caseId],
  );

  const deletePerson = useCallback(
    async (personId: string): Promise<void> => {
      const response = await apiFetch(`/api/v1/relationships/${caseId}/persons/${personId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("인물 삭제에 실패했습니다");
    },
    [caseId],
  );

  const savePosition = useCallback(
    async (personId: string, x: number, y: number): Promise<void> => {
      const response = await apiFetch(
        `/api/v1/relationships/${caseId}/persons/${personId}/position?position_x=${Math.round(x)}&position_y=${Math.round(y)}`,
        { method: "PATCH" },
      );
      if (!response.ok) {
        console.error("[RelationshipEditor] Failed to save position");
      }
    },
    [caseId],
  );

  const addRelationship = useCallback(
    async (
      sourceId: string,
      targetId: string,
      label: string,
      memo: string,
      directed: boolean,
    ): Promise<RelationshipEdge> => {
      const response = await apiFetch(`/api/v1/relationships/${caseId}/relationships`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_person_id: parseInt(sourceId),
          target_person_id: parseInt(targetId),
          relationship_type: label,
          label,
          memo,
          is_directed: directed,
        }),
      });
      if (!response.ok) throw new Error("관계 추가에 실패했습니다");
      const created = await response.json();
      return {
        id: String(created.id),
        sourceId: String(created.source_person_id),
        targetId: String(created.target_person_id),
        label: created.label,
        memo: created.memo,
        directed: created.is_directed,
      };
    },
    [caseId],
  );

  const updateRelationship = useCallback(
    async (relId: string, label: string, memo: string, directed: boolean): Promise<void> => {
      const response = await apiFetch(`/api/v1/relationships/${caseId}/relationships/${relId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          relationship_type: label,
          label,
          memo,
          is_directed: directed,
        }),
      });
      if (!response.ok) throw new Error("관계 수정에 실패했습니다");
    },
    [caseId],
  );

  const deleteRelationship = useCallback(
    async (relId: string): Promise<void> => {
      const response = await apiFetch(`/api/v1/relationships/${caseId}/relationships/${relId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("관계 삭제에 실패했습니다");
    },
    [caseId],
  );

  return {
    addPerson,
    updatePerson,
    deletePerson,
    savePosition,
    addRelationship,
    updateRelationship,
    deleteRelationship,
  };
}
