<script lang="ts">
  import { formatUtc } from "#lib/format";

  // Shown after three failed syncs in a row (Technical Plan, "Sync loop").
  let { since }: { since: string } = $props();
</script>

<p role="status" class="stale">
  <strong>Content may be out of date</strong> since
  <time datetime={since}>{formatUtc(since)}</time>. The site is showing the last
  version it could load.
</p>

<style>
  .stale {
    margin: 0;
    padding: 0.6rem 1rem;
    text-align: center;
    background: var(--warn-bg);
    color: var(--warn-fg);
    border-bottom: 1px solid var(--warn);
  }
</style>
