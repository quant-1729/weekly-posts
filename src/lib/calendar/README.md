# Festival and occasion calendar

`festivals.json` lists Indian festivals, observances, national days and seasons for 2026-10-13 to 2027-10-31, sorted by `date`; the weekly plan (R3) reads it.
Fields: `key` unique id; `date` start and `end_date` optional end (YYYY-MM-DD); `type` festival | national | observance | season | shopping; `regions` pan-india or state names; `religion` hindu | muslim | sikh | christian | jain | buddhist | null; `lead_days` days before `date` that posting usually starts; `good_for` business categories; `confidence` high | medium | low (lunar and moon-sighting dates are medium at best).
Dates were AI-drafted, then checked by the orchestrator on 2026-10-13 against drikpanchang.com, calendarific.com and hindupad.com (30 dates corrected). Islamic dates stay `medium`: they depend on moon sighting. Re-check lunar dates a month ahead.
To extend for next year, append the next 12 months, keep the array sorted by `date`, keep keys unique, and mark every lunar date `medium` or `low` with a reason in `source_note`.
