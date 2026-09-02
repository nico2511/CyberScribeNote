<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { applyTheme, loadTheme } from "$lib/stores/theme";

  let { children } = $props();

  onMount(() => {
    applyTheme(loadTheme());
  });
</script>

{@render children()}
