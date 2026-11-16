<script lang="ts">
  import { formatUtc } from "#lib/format";

  interface FooterData {
    commit: string;
    commitUrl: string;
    lastSync: string | null;
    lastSyncError: string | null;
    mtgjsonVersion: string;
    engineVersion: string;
  }

  let { footer }: { footer: FooterData } = $props();
</script>

<footer>
  <p class="facts">
    <span
      >Commit
      <a href={footer.commitUrl}><code>{footer.commit.slice(0, 7)}</code></a
      ></span
    >
    {#if footer.lastSync}
      <span
        >Last sync
        <time datetime={footer.lastSync}>{formatUtc(footer.lastSync)}</time
        ></span
      >
    {/if}
    <span>MTGJSON <code>{footer.mtgjsonVersion}</code></span>
    <span>Engine <code>{footer.engineVersion}</code></span>
  </p>
  {#if footer.lastSyncError}
    <p class="error">Last sync failed: {footer.lastSyncError}</p>
  {/if}
  <p class="legal">
    Card images are provided by Scryfall. Magic: The Gathering is a trademark of
    Wizards of the Coast. This site is unofficial fan content.
  </p>
</footer>

<style>
  footer {
    margin-top: 3rem;
    padding: 1.25rem 0 2rem;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 0.85rem;
  }
  p {
    margin: 0 0 0.4rem;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1.25rem;
  }
  .error {
    color: var(--bad);
  }
  .legal {
    font-size: 0.8rem;
  }
</style>
