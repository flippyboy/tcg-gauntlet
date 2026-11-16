<script lang="ts">
  // The ways to take a deck away: two text exports, the Arena page and the proxy
  // printer. A `<details>` element, so it opens without JavaScript.
  let {
    links,
  }: { links: { mtgo: string; dec: string; mtga: string; proxies: string } } =
    $props();
</script>

<details class="menu">
  <summary>Export</summary>
  <ul aria-label="Export options">
    <li>
      <a href={links.mtgo} download>MTGO <small>.txt</small></a>
    </li>
    <li>
      <a href={links.dec} download
        >Cockatrice and Workstation <small>.dec</small></a
      >
    </li>
    <li><a href={links.mtga}>MTG Arena <small>copy text</small></a></li>
    <li><a href={links.proxies}>Print proxies <small>PDF</small></a></li>
  </ul>
</details>

<style>
  .menu {
    position: relative;
    display: inline-block;
  }
  summary {
    list-style: none;
    cursor: pointer;
    padding: 0.4rem 0.9rem;
    border: 1px solid var(--accent);
    border-radius: 0.5rem;
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 600;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary::after {
    content: " ▾";
  }
  summary:focus-visible {
    outline: 2px solid var(--fg);
    outline-offset: 2px;
  }
  ul {
    position: absolute;
    z-index: 10;
    margin: 0.3rem 0 0;
    padding: 0.3rem;
    list-style: none;
    min-width: 15rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    box-shadow: 0 0.5rem 1.5rem var(--shadow);
  }
  a {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 0.7rem;
    border-radius: 0.4rem;
    color: var(--fg);
    text-decoration: none;
  }
  a:hover,
  a:focus-visible {
    background: var(--hover);
  }
  small {
    color: var(--muted);
  }
</style>
