---
name: product-planning
description: >
  Structured product thinking for MediChain — turning ideas into PRDs, user stories,
  MVP scope decisions, and prioritised backlogs BEFORE any code is written. Covers the
  user-first frame ("who hurts and how"), MoSCoW prioritisation, scope guards against
  feature creep, and the "build vs buy vs delay" decision. Activate when the user says
  "I have an idea", "let's add X", "new feature", "PRD", "user story", "MVP", "scope",
  "what should we build next", "roadmap", or presents a vague concept that needs shaping
  before code starts. Plan first. Code second.
---

# Product Planning for MediChain

MediChain has a clear North Star: **a national health ID Africans can trust, that saves
lives in emergencies and gives patients control of their data.** Every feature either
moves toward that or it doesn't belong.

The cost of building the wrong thing well is much higher than building the right thing
roughly. Plan before you build.

---

## The Frame: User → Problem → Solution → Proof

For every proposed feature, force the answer to four questions:

1. **Who is the user?** A specific persona. "Patient" is too broad. "A 34-year-old
   diabetic in Soweto who runs out of insulin on weekends" is useful.
2. **What is their problem?** Stated as their pain, not as your solution. "Patients
   lose paper prescriptions" not "we need a prescription tracker".
3. **What is the smallest solution that addresses it?** Smallest, not best. You can
   always add more.
4. **How will we know it worked?** A measurable outcome. "30% of users tap their
   card at least once a quarter" is testable. "Improved engagement" is not.

If any answer is vague, the feature isn't ready to build.

---

## PRD Template (Product Requirements Document)

---

## MoSCoW for Hackathon-Speed Shipping

You've shipped at hackathon speed. The trick is being honest about Must vs Should.

| Bucket    | Definition                                              |
|-----------|---------------------------------------------------------|
| **Must**  | If this isn't done, the feature is broken/unsafe        |
| **Should**| Important but feature works without it                  |
| **Could** | Nice if time permits                                    |
| **Won't** | Explicitly deferred — protects against scope creep      |

**Discipline:** Don't promote a Could to Must mid-sprint. If you discover a real Must,
something else has to drop to Should or out.

---

## MVP — "What's the smallest version someone would actually use?"

For each MediChain feature, define the v0 that's:
- Embarrassing in features but not embarrassing in quality
- Solves the ONE main pain
- Can be built in days, not weeks
- Generates real signal about whether anyone cares

### Example: Emergency Access MVP
- ❌ NOT MVP: Multi-tier paramedic credentials, employer verification, offline patient
  data caching, push notifications, biometric paramedic auth
- ✅ MVP: Patient gets one card. Paramedic taps. Web page shows blood type, allergies,
  emergency contact. Audit log entry written. That's it.

If the MVP doesn't get used, the v1 features wouldn't have either. If it does get
used, the v1 features have a real signal to inform priorities.

---

## Roadmap (rolling, never written in stone)

`NOW` should be small enough that you finish it. `NEXT` is best guess. `LATER` is
"don't forget about this" — not a commitment.

---

## Build vs Buy vs Delay

For every dependency or feature, force the choice:

| Option | When to choose                                                   |
|--------|------------------------------------------------------------------|
| Build  | Core to differentiation, exists nowhere good, simple to build   |
| Buy/SDK| Solved problem, mature ecosystem, your version won't be better   |
| Delay  | Not yet validated as needed, no user has actually asked for it   |

For MediChain:
- **Delay:** advanced analytics, bulk hospital onboarding, anything that requires
  enterprise sales motion before you have product-market fit

---

## The Scope Creep Conversation

When someone says "while you're in there, can you also add…":

1. Acknowledge: "Good idea."
2. Ask: "Is it Must, Should, or Could for this sprint?"
3. If Must — what drops?
4. If Should/Could — file as a separate PRD/issue, queued.
5. Ship the original scope. Address the addition next sprint.

This is hard. Saying yes feels collaborative. Saying yes ships nothing on time.

---

## Validation Before Coding

For features beyond a couple of days of work, validate the demand cheaply first:

- **Manual mock-up:** Show a Figma to 5 target users. Do they get it? Want it?
- **Wizard of Oz:** Implement the front, fake the back manually. Will users
  actually use it?
- **Landing page test:** Describe the feature, count signups for "early access."
- **Existing-user interviews:** Ask current users about the pain. Don't ask "would
  you use X?" (people lie). Ask about their last week.

If you can't get to "this is genuinely valuable" cheaply, building it won't fix that.

---

## Anti-patterns

- ❌ Starting code before user + problem + solution + measure are all clear
- ❌ "We can always cut scope later" → you usually don't
- ❌ Adding a feature because a competitor has it
- ❌ Adding a feature because YOU think it's cool
- ❌ Skipping the privacy/security review for "small" features
- ❌ Treating the roadmap as a contract instead of a hypothesis
- ❌ Building for a market segment (enterprise hospitals) before nailing one persona
  (the township paramedic + the diabetic patient)

---

## When in doubt: SHIP NARROW.

Better to have a single feature loved by 100 users than 10 features tolerated by
nobody. MediChain wins on trust + reliability + that 3-second tap. Defend those.
Defer everything else.
