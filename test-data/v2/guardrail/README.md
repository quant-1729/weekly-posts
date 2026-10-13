# Guardrail test sets (V-13)

Fixtures only, no AI calls. Each file is a plain JSON array (JSON has no comments, so this README is the header).

- `planted-30.json`: 30 generated posts across all 8 brands (incl. hi, ar, es); planted wrong prices, offers, hours, dates, phones, claims and quantities must be flagged, allowed facts must not be. Tests Req 11 / AC 11.
- `regulated-20.json`: 20 regulated-category posts (harbour-dental, maple-ledger, cellar-door, inline Toronto law firm): 12 with outcome promises, 8 clean. Tests Req 12 / AC 12 (manual review).
- `repetition.json`: 20 captions with 4-week history: 8 repeats (incl. Hindi and case/punctuation-only), 4 fact-exempt, 4 older than 4 weeks, 4 five-word near misses. Tests Req 13 / AC 13.
