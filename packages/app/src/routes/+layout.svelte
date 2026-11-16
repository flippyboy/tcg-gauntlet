<script lang="ts">
  import type { Snippet } from "svelte";
  import Footer from "#lib/components/Footer.svelte";
  import StaleBanner from "#lib/components/StaleBanner.svelte";
  import "../lib/theme.css";
  import type { LayoutData } from "./$types";

  let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<a class="skip" href="#content">Skip to content</a>

{#if data.staleSince}
  <StaleBanner since={data.staleSince} />
{/if}

<header class="site">
  <div class="bar">
    <a class="brand" href="/">TCG Gauntlet</a>
    <nav aria-label="Main"><a href="/">Gauntlets</a></nav>
  </div>
</header>

<div class="page">
  <main id="content">
    {@render children()}
  </main>
  <Footer footer={data.footer} />
</div>

<style>
  .skip {
    position: absolute;
    left: -999px;
    top: 0;
    padding: 0.5rem 1rem;
    background: var(--surface);
    z-index: 100;
  }
  .skip:focus {
    left: 0.5rem;
    top: 0.5rem;
  }
  .site {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .bar,
  .page {
    max-width: var(--measure);
    margin: 0 auto;
    padding-left: 1rem;
    padding-right: 1rem;
  }
  .bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding-top: 0.7rem;
    padding-bottom: 0.7rem;
  }
  .brand {
    color: var(--fg);
    font-weight: 700;
    font-size: 1.1rem;
    text-decoration: none;
  }
  .page {
    padding-top: 1.25rem;
  }
</style>
