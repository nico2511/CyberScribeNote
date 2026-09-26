import { combineSkillPlan } from "$lib/ai/skillRouter";
import type { SkillId } from "$lib/ai/skills";

/** Enchaîne les skills d'un plan, dans l'ordre, sans les appliquer tout seul. */
export async function runSkillSequence(
  ids: readonly SkillId[],
  runSkill: (id: SkillId) => Promise<void>,
  setStatus?: (message: string) => void,
): Promise<void> {
  if (!ids.length) return;
  setStatus?.(combineSkillPlan({ skills: [...ids] }));
  for (const id of ids) {
    await runSkill(id);
  }
}
