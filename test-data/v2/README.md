# Weekly Posts v2 test data

Test inputs for the global weekly-posts build (PRD: docs/6-prd-v2.md). Each file is listed with what it tests and the Req it covers.

- `websites/corner-bakery/index.html`: home page, Friday offer and two differentiators; tests fact extraction (Req 3).
- `websites/corner-bakery/menu.html`: six products with £ prices, including Sourdough loaf £4.50; tests product and price extraction (Req 3).
- `websites/corner-bakery/about.html`: narrative page with the opening year and a few named people; tests that non-fact prose is ignored (Req 3).
- `websites/corner-bakery/contact.html`: weekday, Saturday and Sunday hours (different weekend hours), holiday closure, address, phone and email; tests hours, address, phone and email extraction (Req 3).
- `websites/corner-bakery/blog.html`: irrelevant page with no business facts; tests that the reader does not invent facts from it (Req 3).
- `websites/corner-bakery/careers.html`: irrelevant page disallowed by robots.txt that contains "£12.50 an hour"; this value must NOT appear in extracted facts if robots.txt is respected (Req 3).
- `websites/corner-bakery/robots.txt`: allows all crawlers except /careers.html; tests robots.txt disallow handling (Req 3).
- `websites/corner-bakery/expected-facts.json`: 22 facts a good extractor should find, each with its page; the 80% threshold is measured against this list (Req 3).
- `websites/harbour-dental/index.html`: home page with the risky banner "Pain-free dentistry guaranteed!"; tests that it is recorded as a claim with its source page (Req 3, source per Req 5).
- `websites/harbour-dental/services.html`: six services, three priced in $ and three "Price on consultation"; tests price extraction and the no-price case (Req 3).
- `websites/harbour-dental/about.html`: two dentists with years in practice and a licensing statement; tests differentiator and claim extraction (Req 3).
- `websites/harbour-dental/contact.html`: office hours including Closed weekends, address, phone, email and parking; tests hours, address, phone and claim extraction (Req 3).
- `websites/harbour-dental/robots.txt`: allows all crawlers; tests that a fully allowed site is read in full (Req 3).
- `websites/harbour-dental/expected-facts.json`: 23 facts a good extractor should find, including the pain-free claim with its page (Req 3).
- `websites/blue-wave-yoga/index.html`: home page with facts that must not be read; robots.txt disallows it (Req 3).
- `websites/blue-wave-yoga/timetable.html`: class timetable and studio hours; must not be read (Req 3).
- `websites/blue-wave-yoga/pricing.html`: casual class and pass prices; must not be read (Req 3).
- `websites/blue-wave-yoga/robots.txt`: "Disallow: /" for all agents; the reader must fetch nothing here (Req 3).
- `websites/blue-wave-yoga/expected-facts.json`: empty facts list with a top-level note; a non-empty result means robots.txt was ignored (Req 3).
- `brands.json`: eight sample businesses across US, GB, AU, CA, IN, AE, SG and ZA, with setup answers, owner facts and a website or null; tests the setup form, brand memory and the no-website path (Req 2, Req 6).
- `past-posts.json`: five past posts per brand (40 total) in local spelling and language; the like_past_posts brands end every post with a pun; prices match each brand's facts; tests uploaded past posts and voice description (Req 4, Req 5).
