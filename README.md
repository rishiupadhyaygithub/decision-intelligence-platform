# DecisionOS — Decision Intelligence Platform

> Built on synthetic ERP/CRM data (Apex Retail India). Turns business data into structured, auditable decisions.

## What it does

Most businesses drown in dashboards but still make decisions on gut feel. DecisionOS solves that — it takes raw operational data (sales, inventory, CRM pipeline) and surfaces *what to decide next*, not just what happened.

Three layers:
- **Memory Layer** — Immutable decision log with semantic search across past decisions
- **Strategy Layer** — AI-powered enrichment, outcome simulation, scenario modeling
- **Action Layer** — Human-in-the-loop approval flows; connects to ERP/CRM/Slack

## Demo Dataset

Built on Apex Retail India — a synthetic 50-SKU retail business with:
- Live inventory anomaly alerts (stockout risk, overstock signals)
- CRM pipeline block detection
- SQL-driven insight extraction

## Stack

Next.js 14 · TypeScript · Supabase · Clerk Auth · Claude API · Recharts

## Status

MVP scaffold complete. Core decision engine and UI functional. Actively building.

## Why I built this

I kept seeing the same problem: analysts build great dashboards, leadership ignores them, decisions happen in WhatsApp threads. This bridges that gap.
