import fs from "node:fs/promises";
import path from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";
import { AppRouter } from "../src/App";
import { publicPaths } from "../src/PublicPage";

const dist = path.resolve("dist");
const template = await fs.readFile(path.join(dist, "index.html"), "utf8");
const isIndexable = process.env.VERCEL_ENV === "production" || (!process.env.VERCEL_ENV && process.env.NODE_ENV === "production");
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
const siteUrl = (process.env.VITE_SITE_URL || (productionHost ? `https://${productionHost}` : "http://localhost:5173")).replace(/\/$/, "");
const verification = process.env.VITE_GOOGLE_SITE_VERIFICATION;

const metadata: Record<string, { title: string; description: string }> = {
  "/": {
    title: "Connectify — Listen to YouTube Together for Free",
    description: "Create a free synchronized YouTube listening room or watch party. Search, paste a link, share the queue, and listen together without an account.",
  },
  "/listen-together": {
    title: "Listen to YouTube Together Online — Connectify",
    description: "Listen to YouTube together with synchronized playback, a fair shared music queue, voting, and no required account.",
  },
  "/watch-party": {
    title: "Watch YouTube Together Online — Connectify Watch Party",
    description: "Start a synchronized YouTube watch party with shared controls, timestamped chat, reactions, and spoiler-safe messages.",
  },
  "/features": {
    title: "Shared Music Queue and Listening Room Features — Connectify",
    description: "Explore Connectify’s YouTube search, collaborative queue, one-person-one-vote system, party modes, reactions, and room controls.",
  },
  "/how-it-works": {
    title: "How Connectify Synchronized Listening Rooms Work",
    description: "Create a room, search or paste a YouTube video, invite friends, and keep everyone synchronized in three simple steps.",
  },
  "/faq": {
    title: "Connectify FAQ — YouTube Listening Rooms and Watch Parties",
    description: "Answers about Connectify accounts, supported YouTube URLs, background playback, privacy, pricing, and room startup.",
  },
  "/privacy": {
    title: "Privacy Notice — Connectify",
    description: "Learn which browser, room, queue, reaction, and chat data Connectify uses to operate free synchronized rooms.",
  },
  "/terms": {
    title: "Terms of Use — Connectify",
    description: "Read the terms for using Connectify’s free shared listening rooms and YouTube watch parties.",
  },
  "/not-found": {
    title: "Page Not Found — Connectify",
    description: "The requested Connectify page could not be found.",
  },
};

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function headFor(route: string) {
  const page = metadata[route];
  const canonical = `${siteUrl}${route === "/" ? "" : route}`;
  const robots = isIndexable && route !== "/not-found" ? "index, follow, max-image-preview:large" : "noindex, nofollow";
  const jsonLd = route === "/" ? JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Connectify",
    url: siteUrl,
    description: page.description,
    applicationCategory: "EntertainmentApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript and a modern web browser",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
    featureList: ["Synchronized YouTube playback", "Collaborative music queue", "YouTube watch parties", "No account required"],
  }).replace(/</g, "\\u003c") : "";
  return [
    `<meta name="robots" content="${robots}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Connectify" />`,
    `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(`${siteUrl}/og-connectify.svg`)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(page.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(page.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(`${siteUrl}/og-connectify.svg`)}" />`,
    verification ? `<meta name="google-site-verification" content="${escapeHtml(verification)}" />` : "",
    jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : "",
  ].filter(Boolean).join("\n    ");
}

function renderPage(route: string) {
  const page = metadata[route];
  return template
    .replace('<meta name="robots" content="noindex, nofollow" />', "")
    .replace('<meta name="description" content="Connectify — free synchronized YouTube listening rooms and watch parties." />', `<meta name="description" content="${escapeHtml(page.description)}" />`)
    .replace("<!-- SEO_HEAD -->", headFor(route))
    .replace("<title>Connectify — Listen together</title>", `<title>${escapeHtml(page.title)}</title>`)
    .replace('<div id="root"></div>', `<div id="root">${renderToString(<AppRouter pathname={route} />)}</div>`);
}

await fs.copyFile(path.join(dist, "index.html"), path.join(dist, "app.html"));
await fs.writeFile(path.join(dist, "index.html"), renderPage("/"), "utf8");
for (const route of publicPaths) {
  const directory = path.join(dist, route.slice(1));
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "index.html"), renderPage(route), "utf8");
}
await fs.writeFile(path.join(dist, "404.html"), renderPage("/not-found"), "utf8");

const date = new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${["/", ...publicPaths].map((route) => `  <url><loc>${escapeHtml(`${siteUrl}${route === "/" ? "" : route}`)}</loc><lastmod>${date}</lastmod></url>`).join("\n")}\n</urlset>\n`;
await fs.writeFile(path.join(dist, "sitemap.xml"), sitemap, "utf8");
await fs.writeFile(path.join(dist, "robots.txt"), isIndexable ? `User-agent: *\nAllow: /\nDisallow: /room/\nDisallow: /share\nSitemap: ${siteUrl}/sitemap.xml\n` : "User-agent: *\nDisallow: /\n", "utf8");

const [homeHtml, appHtml] = await Promise.all([
  fs.readFile(path.join(dist, "index.html"), "utf8"),
  fs.readFile(path.join(dist, "app.html"), "utf8"),
]);
if (!homeHtml.includes("<h1>") || !homeHtml.includes('rel="canonical"') || !homeHtml.includes('"@type":"WebApplication"')) {
  throw new Error("Public prerender verification failed.");
}
if (!appHtml.includes('name="robots" content="noindex, nofollow"') || sitemap.includes("/room/") || sitemap.includes("/share")) {
  throw new Error("Private-route crawler protection verification failed.");
}
