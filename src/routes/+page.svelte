<script lang="ts">
  import { Badge } from "#lib/components/ui/badge/index.js";
</script>

<svelte:head>
  <title>Timetrack – Projektstart</title>
  <meta name="description" content="Deine Arbeitszeit, übersichtlich an einem Ort." />
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
  <div><Badge variant="secondary">TIMETRACK · PROJEKTSTART</Badge></div>
  <h1 class="text-4xl font-semibold tracking-tight sm:text-5xl">Deine Zeit. Dein Überblick.</h1>
  <p class="max-w-xl text-lg text-muted-foreground">Hier entsteht deine Übersicht für Arbeitszeit, Homeoffice und Berichtsheft.</p>
  <section class="rounded-xl border bg-card p-6 text-card-foreground">
    <h2 class="font-semibold">Die Grundlage steht</h2>
    <p class="mt-2 text-muted-foreground">Anmeldung und Zeiterfassung sind noch in Entwicklung.</p>
  </section>
</main>
