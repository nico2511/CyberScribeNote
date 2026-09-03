export interface OutlineItem {
  level: number;
  text: string;
  offset: number;
}

export { extractOutline } from "$lib/markdown/bridge";
