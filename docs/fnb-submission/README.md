# MediChain FNB research and positioning workshop

Prepared 7 October 2026. **These are brainstorming and document-structure drafts, not a final submission.** The developer explicitly asked to defer external pilots/users/feedback until AWS hosting and subsequent evaluation. No such results are included. No entry, enquiry or external message has been sent. No application code or running service was changed.

## Recommended reading order

1. `05_FNB_Research_and_Requirements.md`: official facts, unresolved requirements, source links, category strategy and preparation calendar.
2. `01_MediChain_Product_Submission.md`: proposed product story, selling the connected application through continuity, agency and accountability.
3. `02_MediChain_Capability_Evidence.md`: 19 capability families, user value, code presence, dated proof and qualification tasks.
4. `03_MediChain_Judge_Guide.md`: structure of a future hands-on exploration guide.
5. `04_MediChain_Pitch_and_Video_Script.md`: optional three-minute pitch structure. This duration/video is a recommendation, not an official requirement.

PDF counterparts are in `output/pdf/`. `pack_content.json` and the Markdown files preserve editable wording. The Python builder is reproducible with the bundled ReportLab runtime; it reads only source page names and route declarations, never fixture credentials or patient records.

## What the research establishes

- The organiser public LinkedIn listing announces **23 October 2026** as the awards entry deadline, and **23-25 October** for the virtual hackathon. Exact closing time/timezone and awards judging dates remain open.
- Best Health Solution is the strongest initial category. One category is free; each additional category costs R250 excluding VAT under clause 30 of the current 2026 terms.
- The official FAQ publishes seven judging domains and a two-round process. No numerical weights were found.
- The live supporting-files upload provides no visible checklist or mandatory marker. No public evidence establishes company/ID/tax certificates, a pitch deck, video or clinical licence as universal uploads.
- A usable complete solution and remote judge access matter. Publication in a store is not universally required. Formal PWA/device expectations still need organiser confirmation.
- Awards, Academy and hackathon are separate routes. The current hackathon page has six themes; a health application does not automatically fit an event category. Pre-existing code eligibility is unresolved.

## Workshop decisions

| Decision | Working recommendation | Revisit when |
|---|---|---|
| Main story | Patient context moving between care roles | Hosted demonstration is qualified |
| Category | Best Health Solution first | Organiser clarifies event/category eligibility |
| Uploads | Product brief + evidence appendix + judge guide | Upload format/size/count limits are confirmed |
| Video | Optional three-minute current-build walkthrough | Actual presentation requirement is supplied |
| Commercial story | Facility offering with onboarding/support | Buyer and operating-cost research exists |
| Wider features | Benefit map and evidence tiers | Individual workflows have current durable proof |
| Public evidence | Synthetic app screenshots and workflow recording | Hosted release is available |

## Editable supporting assets

- `page_inventory.csv`: 116 non-test page components, file paths and direct App import references. Page count is an inventory figure, not a completion score.
- `route_inventory.csv`: 126 lines containing Route declarations. Includes wrappers/index/fallback entries; **not 126 distinct user capabilities**.
- `claims_ledger.csv`: benefit hypotheses, exact source files, demonstration tasks and current evidence limits.
- `submission_checklist.csv`: organiser facts vs recommendations, ownership and closure evidence.
- `validation.json`: PDF page/size/text checks and inventory totals. Visual review is separate.

## Important evidence boundaries

The September 27 browser report and October 4 nurse output are dated local evidence. The latter has four failed nurse read-back checks; resolve or disclose them, rather than declaring every nursing pathway complete. Historical doctor/patient checks do not establish the current hosted release. No live test or deployment was performed for this workshop.

No claimed reduction in mortality/errors, time savings, unique worldwide innovation, regulator approval, insurer integration, predictive accuracy or commercial performance appears in the product draft. There is no implied FNB endorsement.

The source list includes official pages, public organiser social statements, a primary winner story, historical judge commentary and entrant examples. Older programmes and previous entrant packs are examples, not current mandatory requirements. Some public references contain stale year copy or fetch errors; the research brief surfaces these conflicts.

## Before final publication

Regenerate the pack after factual identity, actual hosted URL, current build, permissions, synthetic screenshots and private login instructions are confirmed. Delete workshop/access-status language from the judge-facing edition only when replaced with verified information. Keep the research brief internal. Save the submitted build, document versions, entry receipt and fee receipt where applicable.

## Rebuild

Run `docs/fnb-submission/build_pack.py` with Python that provides ReportLab and pypdf. It generates the five PDFs, Markdown drafts, JSON content, CSV inventories and validation output. PDF fonts currently use Windows Arial. Review rendered pages after changes; text extraction alone cannot prove correct layout.
