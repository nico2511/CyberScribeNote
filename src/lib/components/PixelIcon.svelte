<script lang="ts">
  export type PixelIconName =
    | "note"
    | "folder"
    | "folderOpen"
    | "mic"
    | "ai"
    | "search"
    | "wikilink"
    | "chevron"
    | "settings"
    | "theme";

  interface Props {
    name: PixelIconName;
    size?: 16 | 24;
    class?: string;
    title?: string;
  }

  let { name, size = 16, class: className = "", title }: Props = $props();

  const paths: Record<PixelIconName, string> = {
    note: "M3 2h8l4 4v12H3V2zm8 0v4h4M5 8h8M5 11h8M5 14h5",
    folder: "M2 5h5l2 2h7v10H2V5z",
    folderOpen: "M2 6h5l2 2h9v2H4l-2 8h14l2-8H9",
    mic: "M8 2h4v8H8V2zm-2 8a4 4 0 008 0M10 14v4M6 18h8",
    ai: "M4 10h2v4H4zm4-4h4v12H8zm6 2h2v8h-2zM3 18h14",
    search: "M8 3a5 5 0 015 5 5 5 0 01-5 5 5 5 0 01-5-5 5 5 0 015-5zm4.5 8.5L16 16",
    wikilink: "M4 6h4M12 6h4M6 6v8a2 2 0 002 2h0M14 6v8a2 2 0 01-2 2h0M8 10h4",
    chevron: "M6 4l6 6-6 6",
    settings: "M8 2v2M8 16v2M2 8h2M14 8h2M4 4l2 2M12 12l2 2M12 4l2-2M4 12l2 2M8 5a3 3 0 110 6 3 3 0 010-6z",
    theme: "M8 2a6 6 0 100 12 6 6 0 000-12zm0 0v12",
  };
</script>

<svg
  class="pixel-icon {className}"
  width={size}
  height={size}
  viewBox="0 0 20 20"
  fill="none"
  stroke="currentColor"
  stroke-width="1.25"
  stroke-linecap="square"
  stroke-linejoin="miter"
  shape-rendering="crispEdges"
  aria-hidden={title ? undefined : true}
  role={title ? "img" : undefined}
  aria-label={title}
>
  <path d={paths[name]} />
</svg>
